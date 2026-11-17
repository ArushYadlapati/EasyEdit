import { driveFileSize, driveSource, type ReadTokens } from "@/lib/media/read-tokens";
import { SourceReadError, sendFile, type PieceSource, type UploadTransport } from "@/lib/media/uploader";
import type { CopyState, FinishedMove, MoveItem, MovePlan } from "./move";
import type { MoveApi, MoveResult } from "./move-api";
import { MOVE_MESSAGES } from "./move-messages";

// Moves a project from the browser: the server plans the move, the page copies each original the project uses
// (then its preview and poster) from the old space's Drive into the new one, a piece at a time, and the server
// finishes the move in one write. Types only from ./move: it is server code.

export const COPY_STOPPED = MOVE_MESSAGES.copyStopped;
export const MOVE_CANCELED = MOVE_MESSAGES.canceled;

export type MoveProgress = { filesDone: number; filesTotal: number; bytesDone: number; bytesTotal: number };
export type MoveOutcome = { ok: true; moved: FinishedMove } | { ok: false; message: string; canceled?: boolean; code?: string }; // code: the server's, when it refused

export type MoveRunInput = {
  projectId: string;
  toSpaceId: string;
  fromSpaceId: string;
  signal: AbortSignal;
  onProgress(p: MoveProgress): void;
  onPlan?(plan: MovePlan): void;
};

export type MoveRunDeps = {
  api: MoveApi;
  tokens: ReadTokens; // read tokens of the space the project is in
  transport: UploadTransport;
  sleep(ms: number): Promise<void>;
  chunkBytes: number;
  fetch?: typeof fetch;
};

const MAX_ROUNDS = 3; // plans, copies and finishes, while media keeps being added to the project
const SESSION_TRIES = 3; // upload sessions for one original in a round: the first, and new ones after one expired
const FILE_TRIES = 2; // a preview or poster is sent again once from its first byte, as the upload queue does
// Answers that may be different a moment later: no answer, our server failing, or Drive down.
const PASSING = new Set(["NETWORK", "INTERNAL", "STORAGE_UNAVAILABLE"]);

// Ends the copying with a sentence for the person. Canceled when the page's signal was aborted.
class Stopped extends Error {
  constructor(readonly sentence: string, readonly code?: string) {
    super(sentence);
    this.name = "Stopped";
  }
}

const sentenceOf = (refused: { message: string }) => refused.message || COPY_STOPPED;
const stoppedBy = (refused: { message: string; code: string }) => new Stopped(sentenceOf(refused), refused.code);

function valueOf<T>(result: MoveResult<T>): T {
  if (!result.ok) throw stoppedBy(result);
  return result.value;
}

// A source that remembers when Drive said it will never give a piece: the file is gone, or not ours to read. A
// refusal of the destination's session is the transport's, and is not counted here.
function watched(source: PieceSource): { source: PieceSource; unreadable(): boolean } {
  let unreadable = false;
  return {
    source: {
      size: source.size,
      async piece(start, end, signal) {
        try {
          return await source.piece(start, end, signal);
        } catch (error) {
          if (error instanceof SourceReadError && error.kind !== "offline") unreadable = true;
          throw error;
        }
      },
    },
    unreadable: () => unreadable,
  };
}

const filesOf = (item: MoveItem) => 1 + (item.previewFileId ? 1 : 0) + (item.posterFileId ? 1 : 0);
const copiedFilesOf = ({ copy, previewFileId, posterFileId }: MoveItem) =>
  copy === null ? 0 : (copy.status === "ready" ? 1 : 0) + (previewFileId && copy.hasPreview ? 1 : 0) + (posterFileId && copy.hasPoster ? 1 : 0);

export async function runMove(input: MoveRunInput, deps: MoveRunDeps): Promise<MoveOutcome> {
  const { api, tokens, transport, sleep, chunkBytes } = deps;
  const { signal } = input;
  const read = { tokens, fetch: deps.fetch };
  let moveId: string | null = null;

  const canceled = async (): Promise<MoveOutcome> => {
    if (moveId !== null) await api.abandon(moveId);
    return { ok: false, message: MOVE_CANCELED, canceled: true };
  };
  const checkSignal = () => {
    if (signal.aborted) throw new Stopped(MOVE_CANCELED);
  };

  // What has been copied of the plan so far. Previews and posters count as files, and only originals as bytes.
  let progress: MoveProgress = { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 };
  let reported: MoveProgress | null = null;
  function report(patch: Partial<MoveProgress>) {
    progress = { ...progress, ...patch };
    const same = reported && (Object.keys(progress) as (keyof MoveProgress)[]).every((key) => reported![key] === progress[key]);
    if (same) return;
    reported = progress;
    input.onProgress(progress);
  }

  // The original's bytes into its copy, resumed where the copy stopped. The copy's state once the server has it.
  async function copyOriginal(id: string, item: MoveItem, bytesBefore: number): Promise<CopyState> {
    const { source, unreadable } = watched(driveSource(item.originalFileId, item.sizeBytes, read));
    for (let tries = 1; ; tries += 1) {
      const opened = valueOf(await api.openCopy(id, item.sourceAssetId));
      checkSignal();
      const { uploadUrl } = opened;
      if (!opened.done) {
        if (uploadUrl === null) throw new Stopped(COPY_STOPPED);
        report({ bytesDone: bytesBefore + opened.offset });
        // Ended when the page cancels, or when asking again shows the server refuses or opened a new session.
        const sends = new AbortController();
        const cancel = () => sends.abort();
        signal.addEventListener("abort", cancel, { once: true });
        let refused: { message: string; code: string } | null = null;
        let renewed = false;
        const sent = await sendFile(source, { uploadUrl, offset: opened.offset }, {
          transport,
          sleep,
          chunkBytes,
          signal: sends.signal,
          onProgress: (sentBytes) => report({ bytesDone: bytesBefore + sentBytes }),
          // Opening the copy again says how far its session is.
          askOffset: async () => {
            const again = await api.openCopy(id, item.sourceAssetId);
            if (!again.ok) {
              if (PASSING.has(again.code)) return null;
              refused = again;
              sends.abort();
              return null;
            }
            if (again.value.done) return { offset: again.value.offset, done: true };
            if (again.value.uploadUrl !== uploadUrl) {
              renewed = true; // this session expired: the copy goes on in the new one
              sends.abort();
              return null;
            }
            return { offset: again.value.offset, done: false };
          },
        });
        signal.removeEventListener("abort", cancel);
        checkSignal();
        if (refused) throw stoppedBy(refused);
        if (!sent.ok) {
          // Drive will not give the original: no try will copy it, so the person is told which one it is.
          if (unreadable()) throw new Stopped(MOVE_MESSAGES.cantReadSource(item.name));
          if ((renewed || sent.reason === "expired") && tries < SESSION_TRIES) continue;
          throw new Stopped(COPY_STOPPED);
        }
      }
      const completed = valueOf(await api.completeCopy(id, opened.copyAssetId));
      checkSignal();
      return completed;
    }
  }

  // A preview or poster into the copy, from its first byte: the server keeps no offset for these. Null when Drive
  // will not give the source's file: it is skipped, and the move goes on without it (finishing marks a video copy
  // with no preview as failed).
  async function copyFile(id: string, copyAssetId: string, role: "preview" | "poster", fileId: string): Promise<CopyState | null> {
    let sentence: Stopped = new Stopped(COPY_STOPPED);
    for (let attempt = 0; attempt < FILE_TRIES; attempt++) {
      const size = await driveFileSize(fileId, { ...read, signal });
      checkSignal();
      if (size === "missing" || size === "refused") return null;
      if (size === "offline") continue;
      const opened = await api.openCopyFile(id, copyAssetId, role, size);
      checkSignal();
      if (!opened.ok) {
        sentence = stoppedBy(opened);
        continue;
      }
      const { source, unreadable } = watched(driveSource(fileId, size, read));
      const sent = await sendFile(source, { uploadUrl: opened.value.uploadUrl, offset: 0 }, {
        transport,
        sleep,
        chunkBytes,
        signal,
        askOffset: async () => null,
        onProgress: () => {},
      });
      checkSignal();
      if (!sent.ok) {
        if (unreadable()) return null;
        if (sent.reason === "refused") throw new Stopped(COPY_STOPPED);
        sentence = new Stopped(COPY_STOPPED);
        continue;
      }
      const completed = await api.completeCopyFile(id, copyAssetId, role);
      checkSignal();
      if (completed.ok) return completed.value;
      sentence = stoppedBy(completed);
    }
    throw sentence;
  }

  // Every file of the plan that has no finished copy yet, one at a time, in the plan's order.
  async function copyAll(plan: MovePlan) {
    const { items } = plan;
    let filesDone = items.reduce((sum, item) => sum + copiedFilesOf(item), 0);
    let bytesDone = items.reduce((sum, item) => sum + (item.copy?.status === "ready" ? item.sizeBytes : 0), 0);
    progress = {
      filesDone,
      filesTotal: items.reduce((sum, item) => sum + filesOf(item), 0),
      bytesDone,
      bytesTotal: items.reduce((sum, item) => sum + item.sizeBytes, 0),
    };
    reported = null;
    report({});
    for (const item of items) {
      let state = item.copy;
      if (state === null || state.status === "uploading") {
        state = await copyOriginal(plan.moveId, item, bytesDone);
        bytesDone += item.sizeBytes;
        report({ filesDone: (filesDone += 1), bytesDone });
      }
      const copyAssetId = state.assetId;
      // A skipped file counts as done: there is nothing more to do for it.
      if (item.previewFileId && !state.hasPreview) {
        state = (await copyFile(plan.moveId, copyAssetId, "preview", item.previewFileId)) ?? state;
        report({ filesDone: (filesDone += 1) });
      }
      if (item.posterFileId && !state.hasPoster) {
        state = (await copyFile(plan.moveId, copyAssetId, "poster", item.posterFileId)) ?? state;
        report({ filesDone: (filesDone += 1) });
      }
    }
  }

  try {
    for (let round = 1; ; round += 1) {
      checkSignal();
      const planned = await api.start(input.projectId, input.toSpaceId);
      if (planned.ok) moveId = planned.value.moveId;
      checkSignal();
      const plan = valueOf(planned);
      input.onPlan?.(plan);
      await copyAll(plan);
      checkSignal();
      const finished = await api.finish(plan.moveId);
      if (finished.ok) return { ok: true, moved: finished.value };
      checkSignal();
      // Media was added to the project while it was copying: plan again, and copy that too.
      if (finished.code === "NETWORK") {
        // The answer may have been lost after the move was done: ask where the project is.
        const now = await api.projectSpace(input.projectId);
        if (now.ok && now.value.spaceId === input.toSpaceId) {
          return { ok: true, moved: { projectId: input.projectId, spaceId: now.value.spaceId, slug: plan.to.slug, version: now.value.version } };
        }
      }
      if (finished.code !== "COPIES_MISSING") return { ok: false, message: sentenceOf(finished), code: finished.code };
      if (round === MAX_ROUNDS) return { ok: false, message: MOVE_MESSAGES.copiesMissing, code: finished.code };
    }
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    if (signal.aborted) return canceled();
    return error.code === undefined ? { ok: false, message: error.sentence } : { ok: false, message: error.sentence, code: error.code };
  }
}
