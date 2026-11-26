import { describe, expect, it, vi } from "vitest";
import { KEEPALIVE_MAX_BYTES, REQUEST_TIMEOUT_MS, createPresenceApi, createProjectApi } from "@/lib/editor/api";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function apiWith(respond: (url: string) => Response) {
  const fetchFn = vi.fn<typeof fetch>(async (url) => respond(String(url)));
  return { api: createProjectApi("p1", fetchFn), fetchFn };
}

describe("project api", () => {
  it("posts ops as JSON and returns the version and the inverse", async () => {
    const { api, fetchFn } = apiWith(() => json(200, { version: 6, ops: [], inverse: [{ op: "remove_clip", clipId: "n1" }] }));
    expect(await api.postOps({ baseVersion: 5, ops: [{ op: "remove_clip", clipId: "x1" }] }))
      .toEqual({ ok: true, version: 6, inverse: [{ op: "remove_clip", clipId: "n1" }] });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/projects/p1/ops");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(JSON.parse(String(init!.body))).toEqual({ baseVersion: 5, ops: [{ op: "remove_clip", clipId: "x1" }] });
  });

  it("a small post of edits is sent with keepalive, so one saved as the page goes away still lands; a large one is not", async () => {
    const { api, fetchFn } = apiWith(() => json(200, { version: 6, ops: [], inverse: [] }));
    await api.postOps({ baseVersion: 5, ops: [{ op: "remove_clip", clipId: "x1" }] });
    expect(fetchFn.mock.calls[0][1]!.keepalive).toBe(true);
    const long = "é".repeat(KEEPALIVE_MAX_BYTES / 2); // two bytes each: over the limit in bytes, under it in characters
    await api.postOps({ baseVersion: 5, ops: [{ op: "update_clip", clipId: "x1", patch: { text: long } }] });
    expect(fetchFn.mock.calls[1][1]!.keepalive).toBe(false);
  });

  it("puts the request id in the body when one is given", async () => {
    const { api, fetchFn } = apiWith(() => json(200, { version: 6, ops: [], inverse: [] }));
    await api.postOps({ baseVersion: 5, ops: [{ op: "remove_clip", clipId: "x1" }], requestId: "edit_0001" });
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]!.body))).toEqual({
      baseVersion: 5,
      ops: [{ op: "remove_clip", clipId: "x1" }],
      requestId: "edit_0001",
    });
  });

  it("builds the read URLs", async () => {
    const { api, fetchFn } = apiWith((url) => json(200, url.includes("/ops") ? { version: 5, entries: [], hasMore: false } : { version: 5, doc: {}, name: "P" }));
    await api.getVersion();
    await api.getOpsSince(5, 500);
    await api.getProject();
    expect(fetchFn.mock.calls.map((call) => call[0])).toEqual(["/api/projects/p1/version", "/api/projects/p1/ops?since=5&limit=500", "/api/projects/p1"]);
  });

  it("getVersion reads the space the project is in, when the answer names one", async () => {
    expect(await apiWith(() => json(200, { version: 5, spaceId: "s2" })).api.getVersion()).toEqual({ ok: true, version: 5, spaceId: "s2" });
    expect(await apiWith(() => json(200, { version: 5 })).api.getVersion()).toEqual({ ok: true, version: 5 });
    expect(await apiWith(() => json(200, { version: 5, spaceId: 7 })).api.getVersion()).toEqual({ ok: true, version: 5 });
  });

  it("rename sends PATCH with the name and reads the answer", async () => {
    const { api, fetchFn } = apiWith(() => json(200, { id: "p1", name: "Finals" }));
    expect(await api.rename("Finals")).toEqual({ ok: true, name: "Finals" });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/projects/p1");
    expect(init).toMatchObject({ method: "PATCH", headers: { "content-type": "application/json" } });
    expect(String(init!.body)).toBe('{"name":"Finals"}');

    const refused = apiWith(() => json(400, { code: "INVALID", message: "Enter a name up to 100 characters." }));
    expect(await refused.api.rename("x".repeat(101))).toEqual({
      ok: false,
      kind: "op",
      code: "INVALID",
      message: "Enter a name up to 100 characters.",
    });
    expect(await apiWith(() => json(403, { code: "FORBIDDEN", message: "m" })).api.rename("Finals")).toEqual({ ok: false, kind: "forbidden" });
    expect(await apiWith(() => json(200, { id: "p1" })).api.rename("Finals")).toEqual({ ok: false, kind: "network" });
  });

  it("putThumbnail sends the JPEG by PUT with its version and reads saved", async () => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    const { api, fetchFn } = apiWith(() => json(200, { saved: true }));
    expect(await api.putThumbnail(6, jpeg)).toEqual({ ok: true, saved: true });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/projects/p1/thumbnail?v=6");
    expect(init).toMatchObject({ method: "PUT", headers: { "content-type": "image/jpeg" }, cache: "no-store" });
    expect(init!.body).toBe(jpeg);
    expect(init!.keepalive).toBeUndefined();

    expect(await apiWith(() => json(403, { code: "FORBIDDEN", message: "m" })).api.putThumbnail(6, jpeg)).toEqual({ ok: false, kind: "forbidden" });
    expect(await apiWith(() => json(200, {})).api.putThumbnail(6, jpeg)).toEqual({ ok: false, kind: "network" });
  });

  it.each([
    [400, { code: "OVERLAP", message: "m", opIndex: 0 },{ ok: false, kind: "op", code: "OVERLAP", message: "m", opIndex: 0 }],
    [409, { code: "CONFLICT", message: "m", currentVersion: 9 }, { ok: false, kind: "conflict", currentVersion: 9 }],
    [409, { code: "MOVED", message: "m", currentVersion: 9 }, { ok: false, kind: "moved" }],
    [401, { code: "UNAUTHENTICATED", message: "m" }, { ok: false, kind: "signed-out" }],
    [403, { code: "FORBIDDEN", message: "m" }, { ok: false, kind: "forbidden" }],
    [404, { code: "NOT_FOUND", message: "m" }, { ok: false, kind: "not-found" }],
    [404, { code: "MOVED_ELSEWHERE", message: "m" }, { ok: false, kind: "moved-elsewhere" }],
    [429, { code: "LIMIT_EXCEEDED", message: "Too many changes at once. Wait a minute, then keep going." }, { ok: false, kind: "limited", message: "Too many changes at once. Wait a minute, then keep going." }],
    [429, { code: "RATE", message: "m" }, { ok: false, kind: "network" }],
    [500, { code: "INTERNAL", message: "m" }, { ok: false, kind: "network" }],
  ])("maps status %i to a typed failure", async (status, body, expected) => {
    expect(await apiWith(() => json(status, body)).api.postOps({ baseVersion: 5, ops: [] })).toEqual(expected);
  });

  it.each([
    ["a 404 page from the host", 404, null],
    ["a 404 with another code", 404, { code: "ROUTE_MISSING", message: "m" }],
    ["a 401 page from the host", 401, null],
    ["a 401 with another code", 401, { code: "NOT_FOUND", message: "m" }],
  ])("reads %s as a network failure, since only the server's own code means signed out or deleted", async (_name, status, body) => {
    const answer = () =>
      body === null ? new Response("<html>Not here</html>", { status, headers: { "content-type": "text/html" } }) : json(status, body);
    await expect(apiWith(answer).api.getVersion()).resolves.toEqual({ ok: false, kind: "network" });
    await expect(apiWith(answer).api.postOps({ baseVersion: 5, ops: [] })).resolves.toEqual({ ok: false, kind: "network" });
  });

  it("treats a thrown fetch and a non-JSON answer as a network failure", async () => {
    expect(await apiWith(() => { throw new TypeError("Failed to fetch"); }).api.getVersion()).toEqual({ ok: false, kind: "network" });
    expect(await apiWith(() => new Response("<html>", { status: 200 })).api.getVersion()).toEqual({ ok: false, kind: "network" });
  });

  it("treats an error answer whose body is not JSON as a network failure", async () => {
    const html = () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
    await expect(apiWith(html).api.postOps({ baseVersion: 5, ops: [] })).resolves.toEqual({ ok: false, kind: "network" });
    await expect(apiWith(html).api.getOpsSince(5)).resolves.toEqual({ ok: false, kind: "network" });
  });
});

describe("presence api", () => {
  const share = { tabId: "tab_0001", clipIds: ["c1", "c2"], trackId: null, changedAgoMs: 1200 };
  function presenceWith(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const fetchFn = vi.fn<typeof fetch>(async (url, init) => respond(String(url), init));
    return { api: createPresenceApi("p 1", fetchFn), fetchFn };
  }

  it("share POSTs JSON to /presence with no-store and reads the version and the peers", async () => {
    const peers = [{ userId: "u2", name: "Grace", clipIds: ["c1"], trackId: null }];
    const { api, fetchFn } = presenceWith(() => json(200, { version: 7, peers }));
    expect(await api.share(share)).toEqual({ ok: true, version: 7, peers });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/projects/p%201/presence");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" }, cache: "no-store" });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init!.body))).toEqual(share);
  });

  it("an answer without peers, or with peers that are not a list, reads them as null", async () => {
    expect(await presenceWith(() => json(200, { version: 7 })).api.share(share)).toEqual({ ok: true, version: 7, peers: null });
    expect(await presenceWith(() => json(200, { version: 7, peers: "x" })).api.share(share)).toEqual({ ok: true, version: 7, peers: null });
    expect(await presenceWith(() => json(200, { peers: [] })).api.share(share)).toEqual({ ok: false, kind: "network" });
  });

  it("a share reads the space the project is in, when the answer names one", async () => {
    expect(await presenceWith(() => json(200, { version: 7, peers: [], spaceId: "s2" })).api.share(share)).toEqual({ ok: true, version: 7, peers: [], spaceId: "s2" });
    expect(await presenceWith(() => json(200, { version: 7, spaceId: null })).api.share(share)).toEqual({ ok: true, version: 7, peers: null });
  });

  it.each([
    ["a 400", () => json(400, { code: "INVALID", message: "m" })],
    ["a 403", () => json(403, { code: "FORBIDDEN", message: "m" })],
    ["a 405", () => new Response(null, { status: 405 })],
    ["a 413", () => new Response("too big", { status: 413 })],
    ["a 404 page", () => new Response("<html>Not here</html>", { status: 404, headers: { "content-type": "text/html" } })],
    ["a 404 with another code", () => json(404, { code: "ROUTE_MISSING", message: "m" })],
  ])("reads %s as share-refused, never as forbidden", async (_name, answer) => {
    expect(await presenceWith(answer).api.share(share)).toEqual({ ok: false, kind: "share-refused" });
  });

  it("keeps the usual kinds for the server's own signed-out and not-found", async () => {
    expect(await presenceWith(() => json(401, { code: "UNAUTHENTICATED", message: "m" })).api.share(share)).toEqual({ ok: false, kind: "signed-out" });
    expect(await presenceWith(() => json(404, { code: "NOT_FOUND", message: "m" })).api.share(share)).toEqual({ ok: false, kind: "not-found" });
    expect(await presenceWith(() => json(404, { code: "MOVED_ELSEWHERE", message: "m" })).api.share(share)).toEqual({ ok: false, kind: "moved-elsewhere" });
  });

  it.each([
    ["a thrown fetch", () => { throw new TypeError("Failed to fetch"); }],
    ["a timeout", () => { throw new DOMException("The operation timed out.", "TimeoutError"); }],
    ["a 500", () => json(500, { code: "INTERNAL", message: "m" })],
    ["a 502 page", () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } })],
    ["a 401 page", () => new Response("<html>", { status: 401 })],
    ["a 200 that is not JSON", () => new Response("<html>", { status: 200 })],
  ])("reads %s as a network failure", async (_name, answer) => {
    expect(await presenceWith(answer).api.share(share)).toEqual({ ok: false, kind: "network" });
  });

  it("times a share out like every other request", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it("leave sends a keepalive DELETE for the tab and swallows errors", async () => {
    const { api, fetchFn } = presenceWith(() => new Response(null, { status: 204 }));
    api.leave("tab/1");
    expect(fetchFn).toHaveBeenCalledWith("/api/projects/p%201/presence?tab=tab%2F1", { method: "DELETE", keepalive: true, credentials: "same-origin" });

    const rejecting = presenceWith(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(() => rejecting.api.leave("tab_0001")).not.toThrow();
    await Promise.resolve();
    const throwing = createPresenceApi("p1", () => { throw new TypeError("bad"); });
    expect(() => throwing.leave("tab_0001")).not.toThrow();
  });
});
