import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { makeDashboardActions } from "@/lib/projects/dashboard-actions";
import { createFolder } from "@/lib/projects/folders";
import { makeOpsHandlers, makeProjectHandlers } from "@/lib/projects/handlers";
import { createProject, getProject } from "@/lib/projects/service";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { DEFAULT_TRANSFORM, type OpInput } from "@/lib/timeline";
import { joinSpace, testActor, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const MSG = {
  minute: "Too many changes at once. Wait a minute, then keep going.",
  project: "You've reached today's limit for new projects (25). It frees up over the next 24 hours.",
  folder: "A space can have up to 200 folders.",
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const inTeam = `?space=${SEED_TEAM_ID}`;
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const textClip = {
  id: "c1", type: "text", start: 0, duration: 60, text: "GO", transform: { ...DEFAULT_TRANSFORM },
  style: { fontFamily: "Inter", fontSize: 96, fontWeight: 800, color: "#FFFFFF", align: "center" },
};
const addClip = (id: string) => ({ op: "add_clip", trackId: "t1", clip: { ...textClip, id } }) as OpInput;

async function setup() {
  const db = await makeTestDb();
  const user: CurrentUser = testUser({ allowlistRole: "editor" });
  await joinSpace(db, user, "editor");
  const deps = { db: () => db, auth: async () => user };
  const revalidate = vi.fn();
  const actions = makeDashboardActions({ db: () => db, requireUser: async () => user, revalidate, redirect: (p): never => { throw new Error(`REDIRECT ${p}`); } });
  const actor = testActor({ role: "editor" });
  return { db, actor, ops: makeOpsHandlers(deps), projects: makeProjectHandlers(deps), actions };
}

const seedProjects = (db: DB, by: string, n: number) =>
  db.execute(sql`insert into projects (id, space_id, name, format, doc, created_by, updated_by)
    select 'seed' || g, ${SEED_TEAM_ID}, 'S' || g, 'short_9x16', '{}'::jsonb, ${by}, ${by} from generate_series(1, ${n}) g`);
const seedOps = (db: DB, projectId: string, by: string, n: number) =>
  db.execute(sql`insert into project_ops (project_id, version, ops, inverse, actor)
    select ${projectId}, 1000 + g, '[]'::jsonb, '[]'::jsonb, ${by} from generate_series(1, ${n}) g`);
const seedFolders = (db: DB, n: number) =>
  db.execute(sql`insert into folders (id, space_id, name, created_by) select 'f' || g, ${SEED_TEAM_ID}, 'F' || g, 'u1' from generate_series(1, ${n}) g`);

describe("website daily limits, API", () => {
  it("postOps answers 429 with the message at the per-minute limit, and saves nothing", async () => {
    const { db, actor, ops } = await setup();
    const { id } = await createProject(db, actor, { name: "P", format: "short_9x16" });
    await seedOps(db, id, "u1", 600);
    const res = await ops.postOps(post(`http://x/api/projects/${id}/ops`, { baseVersion: 0, ops: [addClip("c1")] }), ctx(id));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: "LIMIT_EXCEEDED", message: MSG.minute });
    expect((await getProject(db, actor, id))?.version).toBe(0);
  });

  it("an agent's ops do not use up the person's allowance", async () => {
    const { db, actor, ops } = await setup();
    const { id } = await createProject(db, actor, { name: "P", format: "short_9x16" });
    await seedOps(db, id, "agent:u1:abc", 500);
    const res = await ops.postOps(post(`http://x/api/projects/${id}/ops`, { baseVersion: 0, ops: [addClip("c1")] }), ctx(id));
    expect(res.status).toBe(200);
  });

  it("a retry of an already-applied request id still answers at the limit", async () => {
    const { db, actor, ops } = await setup();
    const { id } = await createProject(db, actor, { name: "P", format: "short_9x16" });
    const body = { baseVersion: 0, ops: [addClip("c1")], requestId: "retry-aaaa-1" };
    const first = await ops.postOps(post(`http://x/api/projects/${id}/ops`, body), ctx(id));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    await seedOps(db, id, "u1", 600);
    const again = await ops.postOps(post(`http://x/api/projects/${id}/ops`, body), ctx(id));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(firstBody);
    const fresh = await ops.postOps(post(`http://x/api/projects/${id}/ops`, { ...body, requestId: "other-aaaa-2" }), ctx(id));
    expect(fresh.status).toBe(429);
  });

  it("create and duplicate answer 429 at the project limit; existing projects still open, edit, rename and delete", async () => {
    const { db, actor, ops, projects } = await setup();
    const { id } = await createProject(db, actor, { name: "P", format: "short_9x16" });
    await seedProjects(db, "u1", 24); // 25 in all with the first
    const create = await projects.create(post(`http://x/api/projects${inTeam}`, { name: "N", format: "short_9x16" }));
    expect(create.status).toBe(429);
    expect(await create.json()).toEqual({ code: "LIMIT_EXCEEDED", message: MSG.project });
    const dup = await projects.duplicate(post(`http://x/api/projects/${id}/duplicate`, {}), ctx(id));
    expect(dup.status).toBe(429);
    expect(await dup.json()).toEqual({ code: "LIMIT_EXCEEDED", message: MSG.project });

    expect((await projects.get(new Request(`http://x/api/projects/${id}`), ctx(id))).status).toBe(200);
    expect((await ops.postOps(post(`http://x/api/projects/${id}/ops`, { baseVersion: 0, ops: [addClip("c1")] }), ctx(id))).status).toBe(200);
    const rename = await projects.rename(post(`http://x/api/projects/${id}`, { name: "Renamed" }), ctx(id));
    expect(rename.status).toBe(200);
    expect((await projects.remove(new Request(`http://x/api/projects/${id}`, { method: "DELETE" }), ctx(id))).status).toBe(204);
  });

  it("another person's projects do not count", async () => {
    const { db, projects } = await setup();
    await seedProjects(db, "someone-else", 25);
    const create = await projects.create(post(`http://x/api/projects${inTeam}`, { name: "N", format: "short_9x16" }));
    expect(create.status).toBe(201);
  });
});

describe("website daily limits, dashboard actions", () => {
  it("create and duplicate return the message at the project limit", async () => {
    const { db, actor, actions } = await setup();
    const { id } = await createProject(db, actor, { name: "P", format: "short_9x16" });
    await seedProjects(db, "u1", 24);
    expect(await actions.create(SEED_TEAM_ID, {}, form({ name: "N", format: "short_9x16" }))).toEqual({ error: MSG.project });
    expect(await actions.duplicate(SEED_TEAM_ID, form({ id }))).toEqual({ error: MSG.project });
    expect(await actions.rename(SEED_TEAM_ID, form({ id, name: "Renamed" }))).toEqual({});
    expect(await actions.remove(SEED_TEAM_ID, form({ id }))).toEqual({});
  });

  it("create folder returns the message at 200 folders", async () => {
    const { db, actions } = await setup();
    await seedFolders(db, 200);
    expect(await actions.createFolder(SEED_TEAM_ID, form({ name: "One more" }))).toEqual({ error: MSG.folder });
  });
});

describe("createFolder cap", () => {
  it("refuses the 201st folder for any caller, and counts only that space", async () => {
    const { db, actor } = await setup();
    await seedFolders(db, 199);
    await expect(createFolder(db, actor, "Last")).resolves.toMatchObject({ name: "Last" });
    await expect(createFolder(db, actor, "Over")).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", status: 429, message: MSG.folder });
  });
});
