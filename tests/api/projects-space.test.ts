import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/access-rules";
import { makeOpsHandlers, makeProjectHandlers } from "@/lib/projects/handlers";
import { createProject } from "@/lib/projects/service";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { DEFAULT_TRANSFORM, type OpInput } from "@/lib/timeline";
import { joinSpace, testActor, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "u1" }, "admin");
  await joinSpace(db, { id: "u1" }, "admin", personalSpaceId("u1"));
  await joinSpace(db, { id: "u2" }, "editor");
  let current: CurrentUser = testUser({ id: "u2", allowlistRole: "editor" });
  const auth = vi.fn(async () => current);
  const deps = { db: () => db, auth };
  const as = (id: string) => { current = testUser({ id, allowlistRole: id === "u1" ? "admin" : "editor" }); };
  return { db, as, projects: makeProjectHandlers(deps), ops: makeOpsHandlers(deps) };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const addClip = {
  op: "add_clip",
  trackId: "t1",
  clip: { id: "c1", type: "text", start: 0, duration: 60, text: "x", transform: { ...DEFAULT_TRANSFORM }, style: { fontFamily: "Inter", fontSize: 96, fontWeight: 800, color: "#FFFFFF", align: "center" } },
} as OpInput;
const postOps = (id: string) =>
  new Request(`http://x/api/projects/${id}/ops`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseVersion: 0, ops: [addClip] }) });

describe("project routes and spaces", () => {
  it("GET /api/projects needs ?space= and membership", async () => {
    const { db, as, projects } = await setup();
    const team = await createProject(db, testActor({ role: "editor" }), { name: "Team", format: "short_9x16" });
    await createProject(db, testActor({ spaceId: personalSpaceId("u1") }), { name: "Mine", format: "short_9x16" });
    as("u2");
    const none = await projects.list(new Request("http://x/api/projects"));
    expect(none.status).toBe(404);
    const other = await projects.list(new Request(`http://x/api/projects?space=${personalSpaceId("u1")}`));
    expect(other.status).toBe(404);
    const unknown = await projects.list(new Request("http://x/api/projects?space=nope"));
    expect(await unknown.json()).toEqual(await other.clone().json());
    const own = await projects.list(new Request(`http://x/api/projects?space=${SEED_TEAM_ID}`));
    expect(own.status).toBe(200);
    expect((await own.json()).projects.map((p: { id: string }) => p.id)).toEqual([team.id]);
    as("u1");
    const mine = await projects.list(new Request(`http://x/api/projects?space=${personalSpaceId("u1")}`));
    expect((await mine.json()).projects.map((p: { name: string }) => p.name)).toEqual(["Mine"]);
  });

  it("POST /api/projects creates in the named space only for a member", async () => {
    const { as, projects } = await setup();
    as("u2");
    const post = (q: string) => projects.create(new Request(`http://x/api/projects${q}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "N", format: "short_9x16" }) }));
    expect((await post("")).status).toBe(404);
    expect((await post(`?space=${personalSpaceId("u1")}`)).status).toBe(404);
    expect((await post(`?space=${SEED_TEAM_ID}`)).status).toBe(201);
  });

  it("a project of another space answers like a missing one", async () => {
    const { db, as, projects, ops } = await setup();
    const { id } = await createProject(db, testActor({ spaceId: personalSpaceId("u1") }), { name: "Mine", format: "short_9x16" });
    as("u2");
    const hidden = await projects.get(new Request(`http://x/api/projects/${id}`), ctx(id));
    const missing = await projects.get(new Request("http://x/api/projects/zzz"), ctx("zzz"));
    expect(hidden.status).toBe(404);
    expect((await hidden.json()).code).toBe((await missing.json()).code);
    expect((await ops.postOps(postOps(id), ctx(id))).status).toBe(404);
  });

  it("a removed member gets 404 on the next request", async () => {
    const { db, as, projects, ops } = await setup();
    const { id } = await createProject(db, testActor({ role: "editor" }), { name: "Team", format: "short_9x16" });
    as("u2");
    expect((await projects.get(new Request(`http://x/api/projects/${id}`), ctx(id))).status).toBe(200);
    await db.execute(sql`delete from member where user_id = 'u2' and organization_id = ${SEED_TEAM_ID}`);
    expect((await projects.get(new Request(`http://x/api/projects/${id}`), ctx(id))).status).toBe(404);
    expect((await ops.postOps(postOps(id), ctx(id))).status).toBe(404);
  });
});
