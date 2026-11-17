import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { organization, projectMove, projects } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { makeOpsHandlers, makeProjectHandlers } from "@/lib/projects/handlers";
import { MOVE_MESSAGES } from "@/lib/projects/move-messages";
import { createProject } from "@/lib/projects/service";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { joinSpace, testActor, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

// u1 moved a Seattle Solvers project into their personal space. u2 is in Seattle Solvers only; u3 in another team only.
async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "u1" }, "admin");
  await joinSpace(db, { id: "u1" }, "admin", personalSpaceId("u1"));
  await joinSpace(db, { id: "u2" }, "editor");
  await db.insert(organization).values({ id: "team_other", name: "Other", slug: "other", createdAt: new Date(), kind: "team" });
  await joinSpace(db, { id: "u3" }, "editor", "team_other");
  const project = await createProject(db, testActor({ role: "editor" }), { name: "Recap", format: "short_9x16" });
  await db.update(projects).set({ spaceId: personalSpaceId("u1"), movedAtVersion: 1, version: 1 }).where(eq(projects.id, project.id));
  await db.insert(projectMove).values({ id: "m1", projectId: project.id, fromSpaceId: SEED_TEAM_ID, toSpaceId: personalSpaceId("u1"), startedBy: "u1", finishedAt: new Date() });
  let current: CurrentUser = testUser({ id: "u2", allowlistRole: "editor" });
  const deps = { db: () => db, auth: vi.fn(async () => current) };
  const as = (id: string) => void (current = testUser({ id, allowlistRole: "editor" }));
  return { db, id: project.id, as, projects: makeProjectHandlers(deps), ops: makeOpsHandlers(deps) };
}

type World = Awaited<ReturnType<typeof setup>>;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// What the editor's checks and writes are answered, route by route.
async function answers(t: World) {
  const url = `http://x/api/projects/${t.id}`;
  const responses = [
    await t.projects.version(new Request(`${url}/version`), ctx(t.id)),
    await t.projects.presence(new Request(`${url}/presence`, json({ tabId: "tab_abcdefgh", clipIds: [], trackId: null, changedAgoMs: 0 })), ctx(t.id)),
    await t.ops.getSince(new Request(`${url}/ops?since=0`), ctx(t.id)),
    await t.ops.postOps(new Request(`${url}/ops`, json({ baseVersion: 1, ops: [{ op: "rename_track", trackId: "t1", name: "x" }] })), ctx(t.id)),
    await t.projects.get(new Request(url), ctx(t.id)),
  ];
  return Promise.all(responses.map(async (res) => ({ status: res.status, body: await res.json() })));
}

describe("a project moved to a space the person is not in", () => {
  it("answers a member of the space it left 404 MOVED_ELSEWHERE on the editor's routes", async () => {
    const t = await setup();
    for (const answer of await answers(t)) expect(answer).toEqual({ status: 404, body: { code: "MOVED_ELSEWHERE", message: MOVE_MESSAGES.movedAway } });
    expect(MOVE_MESSAGES.movedAway).toBe("This project was moved to a space you're not in, so it can't be edited here anymore.");
  });

  it("answers a stranger exactly as a missing project", async () => {
    const t = await setup();
    t.as("u3");
    for (const answer of await answers(t)) expect(answer).toEqual({ status: 404, body: { code: "NOT_FOUND", message: `Project "${t.id}" not found` } });
  });

  it("answers a deleted project as missing, even to a member of the space it left", async () => {
    const t = await setup();
    await t.db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, t.id));
    for (const answer of await answers(t)) expect(answer.body.code).toBe("NOT_FOUND");
  });

  it("answers a project that only left a space the person is not in as missing", async () => {
    const t = await setup();
    // Moved on again, from u1's personal space: u2 was never in that one.
    await t.db.insert(projectMove).values({ id: "m2", projectId: t.id, fromSpaceId: personalSpaceId("u1"), toSpaceId: "team_other", startedBy: "u1", finishedAt: new Date(Date.now() + 1000) });
    await t.db.update(projects).set({ spaceId: "team_other" }).where(eq(projects.id, t.id));
    for (const answer of await answers(t)) expect(answer.body.code).toBe("NOT_FOUND");
  });

  it("keeps the 204 of the routes a closing page calls, and lets a member of the new space in", async () => {
    const t = await setup();
    const leave = await t.projects.leave(new Request(`http://x/api/projects/${t.id}/presence?tab=tab_abcdefgh`, { method: "DELETE" }), ctx(t.id));
    expect(leave.status).toBe(204);
    t.as("u1");
    const version = await t.projects.version(new Request(`http://x/api/projects/${t.id}/version`), ctx(t.id));
    expect(await version.json()).toEqual({ version: 1, spaceId: personalSpaceId("u1") });
  });
});
