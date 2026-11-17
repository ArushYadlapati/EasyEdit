import { describe, expect, it } from "vitest";
import { driveFileUrl, type ReadTokens } from "@/lib/media/read-tokens";
import { PieceError, type UploadTransport } from "@/lib/media/uploader";
import type { CopyState, FinishedMove, MoveItem, MovePlan, OpenedCopy } from "@/lib/projects/move";
import { createMoveApi, type MoveApi, type MoveResult } from "@/lib/projects/move-api";
import { MOVE_MESSAGES } from "@/lib/projects/move-messages";
import { COPY_STOPPED, runMove, type MoveProgress } from "@/lib/projects/move-runner";

const bytes = (n: number, from = 0) => new Uint8Array(Array.from({ length: n }, (_, i) => (from + i) % 256));
const MOVED: FinishedMove = { projectId: "p1", spaceId: "s2", slug: "p", version: 7 };

type Source = { id: string; kind: MoveItem["kind"]; original: string; preview: string | null; poster: string | null };

// Video A (an original of 10 bytes, a preview of 6 and a poster of 3) and audio B (an original of 7), in Drive.
const A: Source = { id: "a", kind: "video", original: "orig-a", preview: "prev-a", poster: "post-a" };
const B: Source = { id: "b", kind: "audio", original: "orig-b", preview: null, poster: null };
const C: Source = { id: "c", kind: "image", original: "orig-c", preview: null, poster: null };
const FILES = new Map<string, Uint8Array<ArrayBuffer>>([
  ["orig-a", bytes(10, 1)],
  ["prev-a", bytes(6, 50)],
  ["post-a", bytes(3, 90)],
  ["orig-b", bytes(7, 120)],
  ["orig-c", bytes(5, 200)],
]);

type Copy = { id: string; source: Source; uploadUrl: string; status: "uploading" | "ready"; hasPreview: boolean; hasPoster: boolean };

// The move's server, Drive and the upload sessions, all pretend. `log` says what the runner asked of the server.
function world(options: { sources?: Source[] } = {}) {
  let sources = options.sources ?? [A, B];
  const log: string[] = [];
  const copies = new Map<string, Copy>(); // by source id
  const sessions = new Map<string, { size: number; held: number[]; dead: boolean }>();
  const fileSessions = new Map<string, string>(); // "<copy id> <role>" → its session
  const reads: string[] = [];
  const refusedReads = new Set<string>(); // Drive answers 403
  const missingReads = new Set<string>(); // Drive answers 404
  const refusedPieces = new Set<string>(); // Drive answers 403 to a read of more than the first byte
  let sessionCount = 0;
  // What the next call of a kind answers instead, one entry per call.
  const scripted: Partial<Record<keyof MoveApi, MoveResult<unknown>[]>> = {};
  const pieceHooks: ((input: { uploadUrl: string; start: number }) => void)[] = [];

  const size = (fileId: string) => FILES.get(fileId)!.length;
  const openSession = (bytesTotal: number) => {
    const url = `https://upload.test/s${++sessionCount}`;
    sessions.set(url, { size: bytesTotal, held: [], dead: false });
    return url;
  };
  const stateOf = (copy: Copy): CopyState => ({ assetId: copy.id, status: copy.status, hasPreview: copy.hasPreview, hasPoster: copy.hasPoster });
  const copyById = (id: string) => [...copies.values()].find((copy) => copy.id === id)!;
  const ok = <T,>(value: T): MoveResult<T> => ({ ok: true, value });
  const next = <T,>(name: keyof MoveApi): MoveResult<T> | undefined => scripted[name]?.shift() as MoveResult<T> | undefined;

  const plan = (): MovePlan => ({
    moveId: "m1",
    projectId: "p1",
    to: { id: "s2", name: "Team Two", slug: "team-two", kind: "team" },
    items: sources.map((source) => {
      const copy = copies.get(source.id);
      return {
        sourceAssetId: source.id,
        kind: source.kind,
        name: source.id.toUpperCase(),
        sizeBytes: size(source.original),
        originalFileId: source.original,
        previewFileId: source.preview,
        posterFileId: source.poster,
        copy: copy ? stateOf(copy) : null,
      };
    }),
  });

  const api: MoveApi = {
    async start(projectId, toSpaceId) {
      log.push(`start ${projectId} ${toSpaceId}`);
      return next<MovePlan>("start") ?? ok(plan());
    },
    async openCopy(moveId, sourceAssetId) {
      log.push(`openCopy ${sourceAssetId}`);
      const scriptedAnswer = next<OpenedCopy>("openCopy");
      if (scriptedAnswer) return scriptedAnswer;
      const source = sources.find((one) => one.id === sourceAssetId)!;
      let copy = copies.get(sourceAssetId);
      if (copy?.status === "ready") return ok({ copyAssetId: copy.id, uploadUrl: null, offset: size(source.original), done: true });
      if (!copy) {
        copy = { id: `copy-${sourceAssetId}`, source, uploadUrl: openSession(size(source.original)), status: "uploading", hasPreview: false, hasPoster: false };
        copies.set(sourceAssetId, copy);
      } else if (sessions.get(copy.uploadUrl)!.dead) {
        copy.uploadUrl = openSession(size(source.original));
      }
      const session = sessions.get(copy.uploadUrl)!;
      expect(moveId).toBe("m1");
      return ok({ copyAssetId: copy.id, uploadUrl: copy.uploadUrl, offset: session.held.length, done: session.held.length === session.size });
    },
    async completeCopy(_moveId, copyAssetId) {
      log.push(`completeCopy ${copyAssetId}`);
      const scriptedAnswer = next<CopyState>("completeCopy");
      if (scriptedAnswer) return scriptedAnswer;
      const copy = copyById(copyAssetId);
      expect(sessions.get(copy.uploadUrl)!.held).toEqual([...FILES.get(copy.source.original)!]);
      copy.status = "ready";
      return ok(stateOf(copy));
    },
    async openCopyFile(_moveId, copyAssetId, role, sizeBytes) {
      log.push(`openCopyFile ${copyAssetId} ${role} ${sizeBytes}`);
      const scriptedAnswer = next<{ uploadUrl: string }>("openCopyFile");
      if (scriptedAnswer) return scriptedAnswer;
      const url = openSession(sizeBytes);
      fileSessions.set(`${copyAssetId} ${role}`, url);
      return ok({ uploadUrl: url });
    },
    async completeCopyFile(_moveId, copyAssetId, role) {
      log.push(`completeCopyFile ${copyAssetId} ${role}`);
      const copy = copyById(copyAssetId);
      const fileId = role === "preview" ? copy.source.preview! : copy.source.poster!;
      expect(sessions.get(fileSessions.get(`${copyAssetId} ${role}`)!)!.held).toEqual([...FILES.get(fileId)!]);
      if (role === "preview") copy.hasPreview = true;
      else copy.hasPoster = true;
      return ok(stateOf(copy));
    },
    async finish(moveId) {
      log.push(`finish ${moveId}`);
      const scriptedAnswer = next<FinishedMove>("finish");
      if (scriptedAnswer) return scriptedAnswer;
      const missing = sources.filter((source) => copies.get(source.id)?.status !== "ready").map((source) => source.id);
      if (missing.length > 0) return { ok: false, code: "COPIES_MISSING", message: MOVE_MESSAGES.copiesMissing, missing };
      return ok(MOVED);
    },
    async abandon(moveId) {
      log.push(`abandon ${moveId}`);
    },
  };

  // Drive's read side: ranged reads answer 206 with Content-Range, as for a page that may read it.
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    const fileId = [...FILES.keys()].find((id) => String(input) === driveFileUrl(id));
    if (!fileId) return new Response(null, { status: 404 });
    const range = new Headers(init?.headers).get("range");
    reads.push(`${fileId} ${range}`);
    if (refusedReads.has(fileId)) return new Response(null, { status: 403 });
    if (missingReads.has(fileId)) return new Response(null, { status: 404 });
    if (refusedPieces.has(fileId) && range !== "bytes=0-0") return new Response(null, { status: 403 });
    const file = FILES.get(fileId)!;
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
    if (!match) return new Response(file, { status: 200 });
    const [start, last] = [Number(match[1]), Number(match[2])];
    return new Response(file.slice(start, last + 1), { status: 206, headers: { "Content-Range": `bytes ${start}-${last}/${file.length}` } });
  }) as typeof fetch;

  // The upload sessions: a piece that starts where a session is is kept.
  const transport: UploadTransport = {
    async sendPiece({ uploadUrl, piece, start, total, signal }) {
      for (const hook of pieceHooks.splice(0)) hook({ uploadUrl, start });
      signal.throwIfAborted();
      const session = sessions.get(uploadUrl)!;
      if (session.dead) throw new PieceError("expired");
      expect(total).toBe(session.size);
      if (start === session.held.length) session.held.push(...new Uint8Array(await piece.arrayBuffer()));
      return session.held.length === session.size ? { state: "done" } : { state: "more", next: session.held.length };
    },
  };

  const tokens: ReadTokens = { get: async () => "tok", invalidate: () => undefined };
  const progress: MoveProgress[] = [];
  const sleeps: number[] = [];
  const abort = new AbortController();
  const plans: MovePlan[] = [];
  const run = () =>
    runMove(
      { projectId: "p1", toSpaceId: "s2", fromSpaceId: "s1", signal: abort.signal, onProgress: (p) => void progress.push(p), onPlan: (p) => void plans.push(p) },
      { api, tokens, transport, sleep: async (ms) => void sleeps.push(ms), chunkBytes: 4, fetch: fetchFn },
    );
  return {
    api, log, copies, sessions, reads, refusedReads, missingReads, refusedPieces, scripted, pieceHooks, progress, sleeps, abort, plans, run,
    setSources: (next: Source[]) => void (sources = next),
    seedCopy: (source: Source, state: Partial<Copy> & { held?: number }) => {
      const url = openSession(size(source.original));
      sessions.get(url)!.held.push(...FILES.get(source.original)!.slice(0, state.held ?? 0));
      copies.set(source.id, { id: `copy-${source.id}`, source, uploadUrl: url, status: "uploading", hasPreview: false, hasPoster: false, ...state });
    },
  };
}

describe("moving a project from the browser", () => {
  it("copies each original, then its preview and poster, in plan order, then finishes", async () => {
    const w = world();
    expect(await w.run()).toEqual({ ok: true, moved: MOVED });
    expect(w.log).toEqual([
      "start p1 s2",
      "openCopy a",
      "completeCopy copy-a",
      "openCopyFile copy-a preview 6",
      "completeCopyFile copy-a preview",
      "openCopyFile copy-a poster 3",
      "completeCopyFile copy-a poster",
      "openCopy b",
      "completeCopy copy-b",
      "finish m1",
    ]);
    expect(w.plans.map((plan) => plan.moveId)).toEqual(["m1"]);
    expect(w.sleeps).toEqual([]);
    // Every byte came from a ranged read of the source's own file.
    expect(w.reads.filter((read) => read.startsWith("orig-a"))).toEqual(["orig-a bytes=0-3", "orig-a bytes=4-7", "orig-a bytes=8-9"]);
  });

  it("counts originals' bytes, and previews and posters as files only; the last report has every file done", async () => {
    const w = world();
    await w.run();
    expect(w.progress.map((p) => [p.filesDone, p.bytesDone])).toEqual([
      [0, 0],
      [0, 4],
      [0, 8],
      [0, 10],
      [1, 10],
      [2, 10],
      [3, 10],
      [3, 14],
      [3, 17],
      [4, 17],
    ]);
    expect(w.progress.every((p) => p.filesTotal === 4 && p.bytesTotal === 17)).toBe(true);
    expect(w.progress.at(-1)!.filesDone).toBe(w.progress.at(-1)!.filesTotal);
  });

  it("does not send a copy that is ready with its preview and poster again, and resumes an unfinished one from its offset", async () => {
    const w = world();
    w.seedCopy(A, { status: "ready", hasPreview: true, hasPoster: true, held: 10 });
    w.seedCopy(B, { held: 4 });
    expect(await w.run()).toEqual({ ok: true, moved: MOVED });
    expect(w.log).toEqual(["start p1 s2", "openCopy b", "completeCopy copy-b", "finish m1"]);
    expect(w.reads).toEqual(["orig-b bytes=4-6"]);
    expect(w.progress[0]).toEqual({ filesDone: 3, filesTotal: 4, bytesDone: 10, bytesTotal: 17 });
    expect(w.progress.at(-1)).toEqual({ filesDone: 4, filesTotal: 4, bytesDone: 17, bytesTotal: 17 });
  });

  it("a ready copy that lacks only its poster gets only the poster", async () => {
    const w = world({ sources: [A] });
    w.seedCopy(A, { status: "ready", hasPreview: true, held: 10 });
    expect(await w.run()).toEqual({ ok: true, moved: MOVED });
    expect(w.log).toEqual(["start p1 s2", "openCopyFile copy-a poster 3", "completeCopyFile copy-a poster", "finish m1"]);
  });

  it("after a dropped piece it asks the server where the copy is, by opening it again", async () => {
    const w = world({ sources: [B] });
    w.pieceHooks.push(() => {
      throw new PieceError("network");
    });
    expect(await w.run()).toEqual({ ok: true, moved: MOVED });
    expect(w.log).toEqual(["start p1 s2", "openCopy b", "openCopy b", "completeCopy copy-b", "finish m1"]);
    expect(w.sleeps).toEqual([1000]);
  });

  it("a session that expired is opened again, and the copy goes on in the new one", async () => {
    const w = world({ sources: [B] });
    w.pieceHooks.push(({ uploadUrl }) => void (w.sessions.get(uploadUrl)!.dead = true));
    expect(await w.run()).toEqual({ ok: true, moved: MOVED });
    expect(w.log).toEqual(["start p1 s2", "openCopy b", "openCopy b", "completeCopy copy-b", "finish m1"]);
  });

  it("a session found replaced when asking after a dropped piece is left, and the copy goes on in the new one", async () => {
    const w = world({ sources: [B] });
    w.pieceHooks.push(({ uploadUrl }) => {
      w.sessions.get(uploadUrl)!.dead = true;
      throw new PieceError("network");
    });
    expect(await w.run()).toEqual({ ok: true, moved: MOVED });
    expect(w.log).toEqual(["start p1 s2", "openCopy b", "openCopy b", "openCopy b", "completeCopy copy-b", "finish m1"]);
    expect(w.sleeps).toEqual([1000]);
  });

  it("a refusal when asking where a copy is stops the move with the server's sentence", async () => {
    const w = world({ sources: [B] });
    w.pieceHooks.push(() => {
      w.scripted.openCopy = [{ ok: false, code: "NOT_FOUND", message: MOVE_MESSAGES.gone }];
      throw new PieceError("network");
    });
    expect(await w.run()).toEqual({ ok: false, message: MOVE_MESSAGES.gone });
    expect(w.log).toEqual(["start p1 s2", "openCopy b", "openCopy b"]);
  });

  it("when finishing finds media added meanwhile it plans again, copies the new media and finishes", async () => {
    const w = world();
    w.scripted.finish = [{ ok: false, code: "COPIES_MISSING", message: MOVE_MESSAGES.copiesMissing, missing: ["c"] }];
    const finishOnce = w.api.finish;
    w.api.finish = async (moveId) => {
      const answer = await finishOnce(moveId);
      w.setSources([A, B, C]); // C was added to the project while A and B were copying
      return answer;
    };
    expect(await w.run()).toEqual({ ok: true, moved: MOVED });
    expect(w.log.slice(9)).toEqual(["finish m1", "start p1 s2", "openCopy c", "completeCopy copy-c", "finish m1"]);
    expect(w.plans.map((plan) => plan.moveId)).toEqual(["m1", "m1"]);
    expect(w.progress.at(-1)).toEqual({ filesDone: 5, filesTotal: 5, bytesDone: 22, bytesTotal: 22 });
  });

  it("gives up after three rounds of missing copies, and keeps what was copied", async () => {
    const w = world();
    const missing = { ok: false as const, code: "COPIES_MISSING", message: MOVE_MESSAGES.copiesMissing, missing: ["x"] };
    w.scripted.finish = [missing, missing, missing, missing];
    expect(await w.run()).toEqual({ ok: false, message: MOVE_MESSAGES.copiesMissing });
    expect(w.log.filter((line) => line.startsWith("start"))).toHaveLength(3);
    expect(w.log.filter((line) => line.startsWith("finish"))).toHaveLength(3);
    expect(w.log).not.toContain("abandon m1");
  });

  it("canceled while copying: the move is abandoned and the outcome says canceled", async () => {
    const w = world();
    w.pieceHooks.push(() => w.abort.abort());
    const outcome = await w.run();
    expect(outcome).toMatchObject({ ok: false, canceled: true });
    expect(w.log).toEqual(["start p1 s2", "openCopy a", "abandon m1"]);
  });

  it("canceled once the plan is in, before anything is copied: abandoned, nothing copied", async () => {
    const w = world();
    const start = w.api.start;
    w.api.start = async (...args) => {
      const answer = await start(...args);
      w.abort.abort();
      return answer;
    };
    expect(await w.run()).toMatchObject({ ok: false, canceled: true });
    expect(w.log).toEqual(["start p1 s2", "abandon m1"]);
  });

  it("a piece Drive refuses stops the move without abandoning it, so a retry resumes", async () => {
    const w = world();
    w.pieceHooks.push(() => {
      throw new PieceError("refused");
    });
    expect(await w.run()).toEqual({ ok: false, message: COPY_STOPPED });
    expect(COPY_STOPPED).toBe("Copying stopped. Check your connection and try again; what was copied is kept.");
    expect(w.log).toEqual(["start p1 s2", "openCopy a"]);
  });

  it("an original Drive will not give stops the move, names it, and keeps what was copied", async () => {
    for (const unreadable of ["refusedReads", "missingReads"] as const) {
      const w = world({ sources: [B, A] });
      w[unreadable].add("orig-a");
      expect(await w.run()).toEqual({ ok: false, message: MOVE_MESSAGES.cantReadSource("A") });
      expect(w.log).toEqual(["start p1 s2", "openCopy b", "completeCopy copy-b", "openCopy a"]);
      expect(w.log).not.toContain("abandon m1");
    }
    expect(MOVE_MESSAGES.cantReadSource("A")).toBe('"A" can\'t be read from Google Drive, so it can\'t be copied. Remove it from the project or upload it again, then try the move again.');
  });

  it("a preview that is gone from Drive is skipped, and the move finishes", async () => {
    const w = world();
    w.missingReads.add("prev-a");
    expect(await w.run()).toEqual({ ok: true, moved: MOVED });
    expect(w.log).toEqual([
      "start p1 s2",
      "openCopy a",
      "completeCopy copy-a",
      "openCopyFile copy-a poster 3",
      "completeCopyFile copy-a poster",
      "openCopy b",
      "completeCopy copy-b",
      "finish m1",
    ]);
    expect(w.progress.at(-1)).toEqual({ filesDone: 4, filesTotal: 4, bytesDone: 17, bytesTotal: 17 });
  });

  it("a poster Drive refuses is skipped, and the move finishes", async () => {
    const w = world();
    w.refusedReads.add("post-a");
    expect(await w.run()).toEqual({ ok: true, moved: MOVED });
    expect(w.log).not.toContain("openCopyFile copy-a poster 3");
    expect(w.log.at(-1)).toBe("finish m1");
  });

  it("a preview whose pieces Drive refuses after its size is skipped too", async () => {
    const w = world();
    w.refusedPieces.add("prev-a");
    expect(await w.run()).toEqual({ ok: true, moved: MOVED });
    expect(w.log).toContain("openCopyFile copy-a preview 6");
    expect(w.log).not.toContain("completeCopyFile copy-a preview");
    expect(w.log.at(-1)).toBe("finish m1");
  });

  it("a preview piece the destination refuses still stops the move", async () => {
    const w = world();
    const openFile = w.api.openCopyFile;
    w.api.openCopyFile = async (...args) => {
      w.pieceHooks.push(() => {
        throw new PieceError("refused");
      });
      return openFile(...args);
    };
    expect(await w.run()).toEqual({ ok: false, message: COPY_STOPPED });
    expect(w.log).toEqual(["start p1 s2", "openCopy a", "completeCopy copy-a", "openCopyFile copy-a preview 6"]);
  });

  it("a refusal from the server stops the move with the server's own sentence", async () => {
    const w = world();
    w.scripted.completeCopy = [{ ok: false, code: "CONFLICT", message: "The file is not all there yet." }];
    expect(await w.run()).toEqual({ ok: false, message: "The file is not all there yet." });
    expect(w.log).not.toContain("abandon m1");
    const quiet = world();
    quiet.scripted.openCopy = [{ ok: false, code: "NETWORK", message: "" }];
    expect(await quiet.run()).toEqual({ ok: false, message: COPY_STOPPED });
  });

  it("a refused start says why and asks nothing more", async () => {
    const w = world();
    const message = MOVE_MESSAGES.noStorage("Team Two");
    w.scripted.start = [{ ok: false, code: "NO_STORAGE", message }];
    expect(await w.run()).toEqual({ ok: false, message });
    expect(w.log).toEqual(["start p1 s2"]);
    expect(w.progress).toEqual([]);
  });
});

describe("the move routes, as the browser calls them", () => {
  function answering(...answers: (() => Response | Promise<Response>)[]) {
    const sent: { url: string; method: string | undefined; body: unknown }[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), method: init?.method, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      const answer = answers[sent.length - 1];
      if (!answer) throw new TypeError("Failed to fetch");
      return answer();
    }) as typeof fetch;
    return { fetch: fetchFn, sent };
  }
  const json = (status: number, body: unknown) => () => Response.json(body, { status });
  const state: CopyState = { assetId: "c1", status: "ready", hasPreview: false, hasPoster: false };

  it("calls each route with its method and body, and takes the answer", async () => {
    const plan: MovePlan = { moveId: "m 1", projectId: "p/1", to: { id: "s2", name: "T", slug: "t", kind: "team" }, items: [] };
    const net = answering(
      json(201, plan),
      json(200, { copyAssetId: "c1", uploadUrl: null, offset: 5, done: true }),
      json(200, state),
      json(200, { uploadUrl: "https://upload.test/x" }),
      json(200, state),
      json(200, MOVED),
      () => new Response(null, { status: 204 }),
    );
    const api = createMoveApi(net.fetch);
    expect(await api.start("p/1", "s2")).toEqual({ ok: true, value: plan });
    expect(await api.openCopy("m 1", "a1")).toEqual({ ok: true, value: { copyAssetId: "c1", uploadUrl: null, offset: 5, done: true } });
    expect(await api.completeCopy("m 1", "c1")).toEqual({ ok: true, value: state });
    expect(await api.openCopyFile("m 1", "c1", "preview", 99)).toEqual({ ok: true, value: { uploadUrl: "https://upload.test/x" } });
    expect(await api.completeCopyFile("m 1", "c1", "poster")).toEqual({ ok: true, value: state });
    expect(await api.finish("m 1")).toEqual({ ok: true, value: MOVED });
    await api.abandon("m 1");
    expect(net.sent).toEqual([
      { url: "/api/projects/p%2F1/move", method: "POST", body: { toSpaceId: "s2" } },
      { url: "/api/moves/m%201/copies", method: "POST", body: { sourceAssetId: "a1" } },
      { url: "/api/moves/m%201/copies/c1/complete", method: "POST", body: undefined },
      { url: "/api/moves/m%201/copies/c1/files", method: "POST", body: { role: "preview", sizeBytes: 99 } },
      { url: "/api/moves/m%201/copies/c1/files/complete", method: "POST", body: { role: "poster" } },
      { url: "/api/moves/m%201/finish", method: "POST", body: undefined },
      { url: "/api/moves/m%201", method: "DELETE", body: undefined },
    ]);
  });

  it("a refusal carries the server's code, sentence and missing list", async () => {
    const api = createMoveApi(answering(json(409, { code: "COPIES_MISSING", message: "Some media was added.", missing: ["a", "b"] }), json(409, { code: "NO_STORAGE", message: "No storage." })).fetch);
    expect(await api.finish("m1")).toEqual({ ok: false, code: "COPIES_MISSING", message: "Some media was added.", missing: ["a", "b"] });
    expect(await api.start("p1", "s2")).toEqual({ ok: false, code: "NO_STORAGE", message: "No storage." });
  });

  it("no answer, an answer that is not ours, or one in the wrong shape has no sentence", async () => {
    const api = createMoveApi(answering(() => new Response("<html>bad gateway</html>", { status: 504 }), json(200, { nope: true }), json(400, "x")).fetch);
    expect(await api.finish("m1")).toEqual({ ok: false, code: "NETWORK", message: "" });
    expect(await api.finish("m1")).toEqual({ ok: false, code: "UNEXPECTED", message: "" });
    expect(await api.finish("m1")).toEqual({ ok: false, code: "UNEXPECTED", message: "" });
    expect(await api.finish("m1")).toEqual({ ok: false, code: "NETWORK", message: "" }); // the fetch threw
  });

  it("abandoning never throws", async () => {
    await expect(createMoveApi(answering().fetch).abandon("m1")).resolves.toBeUndefined();
    await expect(createMoveApi(answering(json(404, { code: "NOT_FOUND", message: "gone" })).fetch).abandon("m1")).resolves.toBeUndefined();
  });
});
