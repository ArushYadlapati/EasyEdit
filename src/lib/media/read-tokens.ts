import type { MediaApi } from "./api";
import { SourceReadError, type PieceSource } from "./uploader";

// How the browser reads a file from Drive: with a read-only token our server hands out. The token is kept in
// this module's memory and nowhere else, and is sent in one header and never in an address.

export const TOKEN_MARGIN_MS = 60_000; // a token with less than this left is not used for a new read
// After the server said the space has no storage, or its Drive needs reconnecting, it is not asked again for this
// long: every file read would otherwise ask, and get the same answer.
export const REFUSED_WAIT_MS = 60_000;

export type ReadTokens = { get(): Promise<string | null>; invalidate(): void }; // null: no token could be had

export function createReadTokens(deps: { api: Pick<MediaApi, "readToken">; now?: () => number }): ReadTokens {
  const now = deps.now ?? Date.now;
  let held: { accessToken: string; expiresAt: number } | null = null;
  let asking: Promise<string | null> | null = null; // the request on its way, shared by everyone who asks meanwhile
  let refusedAt: number | null = null; // when the server last said there is no storage to read

  async function ask(): Promise<string | null> {
    try {
      const answer = await deps.api.readToken();
      if (!answer.ok) {
        if (answer.kind === "not-set-up" || answer.kind === "broken") refusedAt = now();
        return null;
      }
      refusedAt = null;
      held = { accessToken: answer.accessToken, expiresAt: answer.expiresAt };
      return held.accessToken;
    } catch {
      return null;
    }
  }

  return {
    async get() {
      if (held && held.expiresAt - now() >= TOKEN_MARGIN_MS) return held.accessToken;
      if (refusedAt !== null && now() - refusedAt < REFUSED_WAIT_MS) return null;
      // Any other failure is not remembered: once the request has ended, the next call asks again.
      asking ??= ask().finally(() => (asking = null));
      return asking;
    },
    // Drive refused the token that is held. One that is on its way is newer, and is kept.
    invalidate() {
      held = null;
    },
  };
}

export function driveFileUrl(fileId: string): string {
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
}

// Why a file could not be read. offline: try again later. missing: Drive has no such file. refused: Drive will not give it to us.
export type ReadProblem = "offline" | "missing" | "refused";

type DriveRead = { ok: true; response: Response } | { ok: false; problem: ReadProblem };

const problem = (which: ReadProblem): DriveRead => ({ ok: false, problem: which });

type ReadDeps = { tokens: ReadTokens; fetch?: typeof fetch; signal?: AbortSignal };

// Asks Drive for a file's bytes: all of them, or those from `range.start` up to, not including, `range.end`. The
// answer's body has not been read yet. It never throws.
export async function readDriveFile(fileId: string, deps: ReadDeps & { range?: { start: number; end: number } }): Promise<DriveRead> {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const headers: Record<string, string> = {};
  if (deps.range) headers.Range = `bytes=${deps.range.start}-${deps.range.end - 1}`;
  for (let attempt = 1; ; attempt += 1) {
    const token = await deps.tokens.get();
    if (token === null) return problem("offline");
    let response: Response;
    try {
      response = await doFetch(driveFileUrl(fileId), { headers: { Authorization: `Bearer ${token}`, ...headers }, signal: deps.signal });
    } catch {
      return problem("offline");
    }
    if (response.ok) return { ok: true, response };
    if (response.status === 404) return problem("missing");
    if (response.status === 403) return problem("refused");
    if (response.status !== 401) return problem("offline");
    // The token was not taken: it ran out early, or the clock here is behind. A new one is tried, once.
    if (attempt === 2) return problem("refused");
    deps.tokens.invalidate();
  }
}

// Lets go of an answer's body without reading it.
function letGo(response: Response) {
  response.body?.cancel().catch(() => {});
}

// A file's size in bytes, from the total in the Content-Range of a one-byte read. Drive does not let a page read
// that header (drive-facts 33), so a page then asks for the whole file and takes its Content-Length, reading none
// of its body.
export async function driveFileSize(fileId: string, deps: ReadDeps): Promise<number | ReadProblem> {
  const first = await readDriveFile(fileId, { ...deps, range: { start: 0, end: 1 } });
  if (!first.ok) return first.problem;
  letGo(first.response);
  const total = /\/(\d+)$/.exec(first.response.headers.get("content-range") ?? "");
  if (total) return Number(total[1]);

  const whole = await readDriveFile(fileId, deps);
  if (!whole.ok) return whole.problem;
  letGo(whole.response);
  const length = whole.response.headers.get("content-length");
  return whole.response.status === 200 && length !== null && /^\d+$/.test(length) ? Number(length) : "offline";
}

// A file in Drive as a source of pieces, each one a ranged read. `size` is the file's own size.
export function driveSource(fileId: string, size: number, deps: { tokens: ReadTokens; fetch?: typeof fetch }): PieceSource {
  return {
    size,
    async piece(start, end, signal) {
      const read = await readDriveFile(fileId, { ...deps, signal, range: { start, end } });
      if (!read.ok) throw new SourceReadError(read.problem);
      const { response } = read;
      // Drive answers a range with 206. A 200 is the whole file: right only when the whole file was asked for.
      if (response.status !== 206 && !(response.status === 200 && start === 0 && end === size)) {
        letGo(response);
        throw new SourceReadError("offline");
      }
      let piece: Blob;
      try {
        piece = await response.blob();
      } catch {
        throw new SourceReadError("offline");
      }
      if (piece.size !== end - start) throw new SourceReadError("offline");
      return piece;
    },
  };
}
