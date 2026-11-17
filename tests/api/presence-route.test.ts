import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { rowsOf, type DB } from "@/db";
import { user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import { makeProjectHandlers } from "@/lib/projects/handlers";
import { checkIn, createPresenceBreaker } from "@/lib/projects/presence";
import { createProject, deleteProject } from "@/lib/projects/service";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const owner: Actor = testActor({ role: "editor" });
const grace: Actor = testActor({ userId: "u2", email: "u2@gmail.com", role: "editor" });

function userWith(role: NonNullable<CurrentUser["allowlistRole"]>): CurrentUser {
  return { id: "u1", email: "u1@gmail.com", name: "U1", image: null, allowlistRole: role };
}

async function setup(role: NonNullable<CurrentUser["allowlistRole"]>) {
  const db = await makeTestDb();
  await db.insert(user).values([
    { id: "u1", name: "U1", email: "u1@gmail.com" },
    { id: "u2", name: "Grace", email: "u2@gmail.com" },
  ]);
  await joinSpace(db, { id: "u1" }, role);
  const auth = vi.fn<(req: Request) => Promise<CurrentUser | Response>>(async () => userWith(role));
  const { id } = await createProject(db, owner, { name: "P", format: "short_9x16" });
  return { db, id, auth, projects: makeProjectHandlers({ db: () => db, auth }) };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const TAB = "tab-u1-0001";

const post = (id: string, body: BodyInit | null, headers?: Record<string, string>) =>
  new Request(`http://x/api/projects/${id}/presence`, { method: "POST", body, headers });

const postJson = (id: string, value: unknown, headers?: Record<string, string>) => post(id, JSON.stringify(value), headers);

const del = (id: string, tab?: string, headers?: Record<string, string>) =>
  new Request(`http://x/api/projects/${id}/presence${tab === undefined ? "" : `?tab=${encodeURIComponent(tab)}`}`, {
    method: "DELETE",
    headers,
  });

// What Grace's own check lists back: u1's selection as a teammate sees it.
async function seenByGrace(db: DB, id: string) {
  return (await checkIn(db, grace, id, { tabId: "tab-u2-0001", clipIds: [], trackId: null, changedAgoMs: 0 }, { breaker: createPresenceBreaker() }))
    ?.peers;
}

async function rowsFor(db: DB, userId: string) {
  return rowsOf<{ tab_id: string; clip_ids: string[]; left: boolean }>(
    await db.execute(sql`select tab_id, clip_ids, left_at is not null as left from project_presence where user_id = ${userId} order by tab_id`),
  );
}

describe("the presence route", () => {
  it("POST answers { version, spaceId, peers }, for a viewer too", async () => {
    const { db, id, auth, projects } = await setup("viewer");
    await checkIn(db, grace, id, { tabId: "tab-u2-0001", clipIds: ["c1"], trackId: "t1", changedAgoMs: 0 }, { breaker: createPresenceBreaker() });
    const res = await projects.presence(postJson(id, { tabId: TAB, clipIds: ["c9"], trackId: null, changedAgoMs: 0 }), ctx(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 0, spaceId: SEED_TEAM_ID, peers: [{ userId: "u2", name: "Grace", clipIds: ["c1"], trackId: "t1" }] });
    expect(auth).toHaveBeenCalledWith(expect.any(Request));
    expect(await seenByGrace(db, id)).toEqual([{ userId: "u1", name: "U1", clipIds: ["c9"], trackId: null }]);
  });

  it("after a move, a tab still open in the old space is answered with the space the project is in now", async () => {
    const { db, id, projects } = await setup("editor");
    const mine = personalSpaceId("u1");
    await joinSpace(db, { id: "u1" }, "admin", mine);
    await db.execute(sql`update projects set space_id = ${mine} where id = ${id}`);
    const res = await projects.presence(postJson(id, { tabId: TAB, clipIds: [], trackId: null, changedAgoMs: 0 }), ctx(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 0, spaceId: mine });
  });

  it("an unknown or deleted project answers 404 NOT_FOUND", async () => {
    const { db, id, projects } = await setup("editor");
    for (const target of ["nope", id]) {
      if (target === id) await deleteProject(db, owner, id);
      for (const req of [postJson(target, { tabId: TAB, clipIds: ["c1"] }), post(target, null)]) {
        const res = await projects.presence(req, ctx(target));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ code: "NOT_FOUND", message: `Project "${target}" not found` });
      }
    }
    expect(await rowsFor(db, "u1")).toEqual([]);
  });

  it("a body that is not JSON, has no valid tabId, or is over 16 KiB answers { version } and writes nothing, never a 400", async () => {
    const { db, id, projects } = await setup("editor");
    const big = JSON.stringify({ tabId: TAB, clipIds: ["c1"], pad: "x".repeat(16 * 1024) });
    const requests = [
      post(id, null),
      post(id, ""),
      post(id, "not json"),
      postJson(id, [TAB]),
      postJson(id, null),
      postJson(id, { clipIds: ["c1"] }),
      postJson(id, { tabId: "short", clipIds: ["c1"] }),
      postJson(id, { tabId: "has spaces in it", clipIds: ["c1"] }),
      postJson(id, { tabId: "x".repeat(65), clipIds: ["c1"] }),
      postJson(id, { tabId: 12345678, clipIds: ["c1"] }),
      post(id, big),
      // A declared length over the limit is refused before the body is read.
      postJson(id, { tabId: TAB, clipIds: ["c1"] }, { "content-length": String(16 * 1024 + 1) }),
    ];
    for (const req of requests) {
      const res = await projects.presence(req, ctx(id));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ version: 0, spaceId: SEED_TEAM_ID });
    }
    expect(await rowsFor(db, "u1")).toEqual([]);
  });

  it("a chunked body over 16 KiB with no content-length is cut off and answers { version }", async () => {
    const { db, id, projects } = await setup("editor");
    const encoder = new TextEncoder();
    let sent = 0;
    let cancelled = false;
    // An endless body: only a reader that stops counting at the limit gets an answer at all.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode(sent === 0 ? `{"tabId":"${TAB}","pad":"` : "x".repeat(1024)));
        sent++;
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request(`http://x/api/projects/${id}/presence`, { method: "POST", body, duplex: "half" } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    const res = await projects.presence(req, ctx(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 0, spaceId: SEED_TEAM_ID });
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(20);
    expect(await rowsFor(db, "u1")).toEqual([]);
  });

  it("a valid tabId with a malformed rest is listed with nothing selected", async () => {
    const { db, id, projects } = await setup("editor");
    const res = await projects.presence(postJson(id, { tabId: TAB, clipIds: "c1", trackId: 5, changedAgoMs: "soon" }), ctx(id));
    expect(await res.json()).toEqual({ version: 0, spaceId: SEED_TEAM_ID, peers: [] });
    expect(await seenByGrace(db, id)).toEqual([{ userId: "u1", name: "U1", clipIds: [], trackId: null }]);

    // An age from the far future or past is clamped, so the statement never fails on it.
    for (const changedAgoMs of [-5, 1e15, Number.MAX_VALUE]) {
      const again = await projects.presence(postJson(id, { tabId: TAB, clipIds: [`c${changedAgoMs}`], changedAgoMs }), ctx(id));
      expect(again.status).toBe(200);
      expect((await again.json()).version).toBe(0);
    }
    expect((await seenByGrace(db, id))?.[0].clipIds).toEqual([`c${Number.MAX_VALUE}`]);
  });

  it("a selection of 150 clips is kept as its first 100, sorted; long or empty ids are dropped", async () => {
    const { db, id, projects } = await setup("editor");
    const clips = Array.from({ length: 150 }, (_, i) => `c${String(i).padStart(3, "0")}`);
    const longest = "a".repeat(64);
    const clipIds = [...clips].reverse().concat(["", "b".repeat(65), longest, "c001", 7 as unknown as string]);
    const res = await projects.presence(postJson(id, { tabId: TAB, clipIds, trackId: "t".repeat(65), changedAgoMs: 0 }), ctx(id));
    expect(res.status).toBe(200);
    expect(await seenByGrace(db, id)).toEqual([
      { userId: "u1", name: "U1", clipIds: [longest, ...clips.slice(0, 99)], trackId: null },
    ]);
  });

  it("a cross-site POST or DELETE is refused 403", async () => {
    const { db, id, projects } = await setup("editor");
    const foreign = { origin: "https://elsewhere.test", host: "x" };
    await projects.presence(postJson(id, { tabId: TAB, clipIds: ["c1"] }), ctx(id));
    for (const res of [
      await projects.presence(postJson(id, { tabId: TAB, clipIds: ["c2"] }, foreign), ctx(id)),
      await projects.leave(del(id, TAB, foreign), ctx(id)),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ code: "FORBIDDEN", message: "This request came from another site." });
    }
    expect(await rowsFor(db, "u1")).toEqual([{ tab_id: TAB, clip_ids: ["c1"], left: false }]);
  });

  it("DELETE answers 204 and marks the row left, and answers 204 for a bad tab id too", async () => {
    const { db, id, projects } = await setup("viewer");
    await projects.presence(postJson(id, { tabId: TAB, clipIds: ["c1"] }), ctx(id));
    expect(await seenByGrace(db, id)).toHaveLength(1);
    const res = await projects.leave(del(id, TAB), ctx(id));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await rowsFor(db, "u1")).toEqual([{ tab_id: TAB, clip_ids: ["c1"], left: true }]);
    expect(await seenByGrace(db, id)).toEqual([]);

    for (const [target, tab] of [[id, "bad tab!"], [id, "short"], [id, undefined], ["nope", TAB]] as const) {
      const other = await projects.leave(del(target, tab), ctx(target));
      expect(other.status).toBe(204);
    }
    expect(await rowsFor(db, "u1")).toEqual([{ tab_id: TAB, clip_ids: ["c1"], left: true }]);
  });

  it("an auth 401 passes through", async () => {
    const { db, id, auth, projects } = await setup("editor");
    auth.mockImplementation(async () => Response.json({ code: "UNAUTHENTICATED", message: "Sign in" }, { status: 401 }));
    for (const res of [
      await projects.presence(postJson(id, { tabId: TAB, clipIds: ["c1"] }), ctx(id)),
      await projects.leave(del(id, TAB), ctx(id)),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Sign in" });
    }
    expect(await rowsFor(db, "u1")).toEqual([]);
  });
});
