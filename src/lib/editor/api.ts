import type { Op, OpErrorCode, TimelineDoc } from "@/lib/timeline";
import type { ActivityEntry } from "./types";

export type ApiFailure =
  | { ok: false; kind: "op"; code: OpErrorCode; message: string; opIndex?: number } // any 400
  | { ok: false; kind: "conflict"; currentVersion: number } // 409
  | { ok: false; kind: "signed-out" } // 401 with the code UNAUTHENTICATED
  | { ok: false; kind: "forbidden" } // 403
  | { ok: false; kind: "not-found" } // 404 with the code NOT_FOUND
  | { ok: false; kind: "network" }; // fetch threw, timed out, 5xx, the body was not JSON, or a 401 or 404 without its code

export type ApiResult<T> = ({ ok: true } & T) | ApiFailure;

export type ProjectApi = {
  postOps(input: { baseVersion: number; ops: Op[]; requestId?: string }): Promise<ApiResult<{ version: number; inverse: Op[] }>>;
  getVersion(): Promise<ApiResult<{ version: number }>>;
  getOpsSince(since: number, limit?: number): Promise<ApiResult<{ version: number; entries: ActivityEntry[]; hasMore: boolean }>>;
  getProject(): Promise<ApiResult<{ doc: TimelineDoc; version: number; name: string }>>;
  rename(name: string): Promise<ApiResult<{ name: string }>>; // not an op: no version, no undo
  putThumbnail(version: number, jpeg: Blob): Promise<ApiResult<{ saved: boolean }>>; // the dashboard picture; not an op: no version, no undo
};

export const REQUEST_TIMEOUT_MS = 15_000;

const NETWORK: ApiFailure = { ok: false, kind: "network" };

// Every code a 400 can carry. A code the client does not know is read as INVALID.
const OP_ERROR_CODES: Record<OpErrorCode, true> = {
  NOT_FOUND: true,
  OVERLAP: true,
  WRONG_TRACK_KIND: true,
  TRACK_LOCKED: true,
  INVALID: true,
  TRIM_OUT_OF_RANGE: true,
  DUPLICATE_ID: true,
  STALE: true,
  LIMIT_EXCEEDED: true,
};

type Body = Record<string, unknown>;

function isBody(v: unknown): v is Body {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function opFailure(body: Body | null): ApiFailure {
  const code = typeof body?.code === "string" && Object.hasOwn(OP_ERROR_CODES, body.code) ? (body.code as OpErrorCode) : "INVALID";
  const failure: ApiFailure = { ok: false, kind: "op", code, message: typeof body?.message === "string" ? body.message : "" };
  if (typeof body?.opIndex === "number") failure.opIndex = body.opIndex;
  return failure;
}

// Signed out and deleted stop the editor, so they are trusted only with the server's own code: a
// 404 or 401 page from something in between (the host, a proxy) is retried like a network failure.
function failureFor(status: number, body: Body | null): ApiFailure {
  switch (status) {
    case 400:
      return opFailure(body);
    case 401:
      return body?.code === "UNAUTHENTICATED" ? { ok: false, kind: "signed-out" } : NETWORK;
    case 403:
      return { ok: false, kind: "forbidden" };
    case 404:
      return body?.code === "NOT_FOUND" ? { ok: false, kind: "not-found" } : NETWORK;
    case 409:
      return typeof body?.currentVersion === "number" ? { ok: false, kind: "conflict", currentVersion: body.currentVersion } : NETWORK;
    default:
      return NETWORK;
  }
}

// Sends one request and reads its JSON body. `pick` takes the fields of a 2xx body, or null when they are missing.
// `mapFailure` reads an error status; a fetch that threw, timed out or gave a 2xx without JSON is always a network failure.
async function send<T, F = ApiFailure>(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  pick: (body: Body) => T | null,
  mapFailure: (status: number, body: Body | null) => F | ApiFailure = failureFor,
): Promise<({ ok: true } & T) | ApiFailure | F> {
  let response: Response;
  try {
    response = await doFetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return NETWORK;
  }
  let body: Body | null = null;
  try {
    const parsed: unknown = await response.json();
    if (isBody(parsed)) body = parsed;
  } catch {
    // Not JSON, or cut off by the time-out. An error status is still mapped, without a body.
    if (response.ok) return NETWORK;
  }
  if (!response.ok) return mapFailure(response.status, body);
  const fields = body && pick(body);
  return fields ? { ok: true, ...fields } : NETWORK;
}

export function createProjectApi(projectId: string, fetchFn?: typeof fetch): ProjectApi {
  const doFetch: typeof fetch = fetchFn ?? ((input, init) => fetch(input, init));
  const base = `/api/projects/${encodeURIComponent(projectId)}`;

  const request = <T>(url: string, init: RequestInit, pick: (body: Body) => T | null) => send(doFetch, url, init, pick);
  const get = <T>(path: string, pick: (body: Body) => T | null) => request(`${base}${path}`, { method: "GET" }, pick);

  return {
    postOps({ baseVersion, ops, requestId }) {
      return request(
        `${base}/ops`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseVersion, ops, requestId }) },
        (b) => (typeof b.version === "number" && Array.isArray(b.inverse) ? { version: b.version, inverse: b.inverse as Op[] } : null),
      );
    },
    getVersion() {
      return get("/version", (b) => (typeof b.version === "number" ? { version: b.version } : null));
    },
    getOpsSince(since, limit) {
      const query = limit === undefined ? `since=${since}` : `since=${since}&limit=${limit}`;
      return get(`/ops?${query}`, (b) =>
        typeof b.version === "number" && Array.isArray(b.entries) && typeof b.hasMore === "boolean"
          ? { version: b.version, entries: b.entries as ActivityEntry[], hasMore: b.hasMore }
          : null,
      );
    },
    getProject() {
      return get("", (b) =>
        typeof b.version === "number" && isBody(b.doc) && typeof b.name === "string"
          ? { version: b.version, doc: b.doc as TimelineDoc, name: b.name }
          : null,
      );
    },
    rename(name) {
      return request(
        base,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) },
        (b) => (typeof b.name === "string" ? { name: b.name } : null),
      );
    },
    putThumbnail(version, jpeg) {
      return request(
        `${base}/thumbnail?v=${version}`,
        { method: "PUT", headers: { "content-type": "image/jpeg" }, body: jpeg },
        (b) => (typeof b.saved === "boolean" ? { saved: b.saved } : null),
      );
    },
  };
}

export type PresenceShare = { tabId: string; clipIds: string[]; trackId: string | null; changedAgoMs: number };
// "share-refused": the server answered, and the answer says the presence route itself is broken or refused this
// request (a 400, 403, 405, 413, or a 404 without the NOT_FOUND code). Other failures keep their usual kinds.
export type PresenceResult = ApiResult<{ version: number; peers: unknown[] | null }> | { ok: false; kind: "share-refused" };
export type PresenceApi = {
  share(input: PresenceShare): Promise<PresenceResult>; // the check for changes with this tab's selection
  leave(tabId: string): void; // fire and forget, with keepalive; never throws
};

const SHARE_REFUSED = { ok: false, kind: "share-refused" } as const;

// A refusal of the share itself (a rollback to a build without the route, a misfiring cross-site check) must not
// revoke editing or stop the editor: the caller falls back to the plain check. A 403 here is never "forbidden".
function shareFailureFor(status: number, body: Body | null): ApiFailure | typeof SHARE_REFUSED {
  if (status === 400 || status === 403 || status === 405 || status === 413) return SHARE_REFUSED;
  if (status === 404 && body?.code !== "NOT_FOUND") return SHARE_REFUSED;
  return failureFor(status, body);
}

export function createPresenceApi(projectId: string, fetchFn?: typeof fetch): PresenceApi {
  const doFetch: typeof fetch = fetchFn ?? ((input, init) => fetch(input, init));
  const base = `/api/projects/${encodeURIComponent(projectId)}/presence`;

  return {
    share({ tabId, clipIds, trackId, changedAgoMs }) {
      return send(
        doFetch,
        base,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tabId, clipIds, trackId, changedAgoMs }) },
        (b) => (typeof b.version === "number" ? { version: b.version, peers: Array.isArray(b.peers) ? (b.peers as unknown[]) : null } : null),
        shareFailureFor,
      );
    },
    leave(tabId) {
      try {
        doFetch(`${base}?tab=${encodeURIComponent(tabId)}`, { method: "DELETE", keepalive: true, credentials: "same-origin" }).catch(() => {
          // Offline or cut off: the row ages out after LIMITS.presenceTtlMs instead.
        });
      } catch {
        // A fetch that throws at once is treated the same way.
      }
    },
  };
}
