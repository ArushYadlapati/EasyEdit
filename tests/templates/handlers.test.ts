import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/access-rules";
import { eq } from "drizzle-orm";
import { projects } from "@/db/schema";
import { createProject, getProject } from "@/lib/projects/service";
import { makeTemplateHandlers } from "@/lib/templates/handlers";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { DEFAULT_TRANSFORM, type Clip } from "@/lib/timeline";
import { joinSpace, testActor, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "ed" }, "editor");
  await joinSpace(db, { id: "vi" }, "viewer");
  await joinSpace(db, { id: "out" }, "admin", personalSpaceId("out"));
  let current: CurrentUser = testUser({ id: "ed" });
  const auth = vi.fn(async (): Promise<CurrentUser | Response> => current);
  const t = makeTemplateHandlers({ db: () => db, auth });
  const as = (id: string) => (current = testUser({ id }));
  const edActor = testActor({ userId: "ed", email: "ed@gmail.com", role: "editor" });
  const { id: projectId } = await createProject(db, edActor, { name: "P", format: "short_9x16" });
  // A template needs at least one slot.
  const doc = structuredClone((await getProject(db, edActor, projectId))!.doc);
  doc.tracks[0].clips = [{ id: "v1", type: "video", assetId: "gone", start: 0, duration: 90, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM }, slot: { name: "hero" } } as Clip];
  await db.update(projects).set({ doc }).where(eq(projects.id, projectId));
  return { t, as, auth, projectId };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const url = (space: string | null, id = "") => `http://x/api/templates${id ? `/${id}` : ""}${space === null ? "" : `?space=${space}`}`;
const send = (method: string, space: string | null, body?: unknown, id = "") =>
  new Request(url(space, id), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const read = async (r: Response) => ({ status: r.status, body: r.status === 204 ? null : await r.json() });

describe("/api/templates", () => {
  it("returns the auth response when not signed in", async () => {
    const { t, auth } = await setup();
    auth.mockResolvedValueOnce(Response.json({ code: "UNAUTHENTICATED", message: "x" }, { status: 401 }));
    expect((await t.list(send("GET", SEED_TEAM_ID))).status).toBe(401);
  });

  it("a viewer lists starters and reads one, but cannot write", async () => {
    const { t, as, projectId } = await setup();
    as("vi");
    const list = await read(await t.list(send("GET", SEED_TEAM_ID)));
    expect(list.status).toBe(200);
    expect(list.body.templates.map((x: { name: string }) => x.name)).toContain("Match Recap");
    const one = await read(await t.get(send("GET", SEED_TEAM_ID), ctx(list.body.templates[0].id)));
    expect(one.body.template.id).toBe(list.body.templates[0].id);
    expect((await t.save(send("POST", SEED_TEAM_ID, { projectId, name: "N" }))).status).toBe(403);
    expect((await t.update(send("PATCH", SEED_TEAM_ID, { name: "N" }), ctx("x"))).status).toBe(403);
    expect((await t.remove(send("DELETE", SEED_TEAM_ID), ctx("x"))).status).toBe(403);
  });

  it("an editor saves (201), replaces (200), patches (204), and deletes (204)", async () => {
    const { t, projectId } = await setup();
    const saved = await read(await t.save(send("POST", SEED_TEAM_ID, { projectId, name: "Mine", description: "d" })));
    expect(saved).toMatchObject({ status: 201, body: { replaced: false } });
    const { id } = saved.body;
    const again = await read(await t.save(send("POST", SEED_TEAM_ID, { projectId, name: "Mine", replace: true })));
    expect(again).toEqual({ status: 200, body: { id, replaced: true } });
    expect((await t.update(send("PATCH", SEED_TEAM_ID, { description: "new" }), ctx(id))).status).toBe(204);
    expect((await read(await t.get(send("GET", SEED_TEAM_ID), ctx(id)))).body.template.description).toBe("new");
    expect((await t.remove(send("DELETE", SEED_TEAM_ID), ctx(id))).status).toBe(204);
    expect((await t.get(send("GET", SEED_TEAM_ID), ctx(id))).status).toBe(404);
  });

  it("a taken name is 409 with the service's message", async () => {
    const { t, projectId } = await setup();
    await t.save(send("POST", SEED_TEAM_ID, { projectId, name: "Mine" }));
    const r = await read(await t.save(send("POST", SEED_TEAM_ID, { projectId, name: "Mine" })));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CONFLICT");
    expect(typeof r.body.message).toBe("string");
  });

  it("a non-member gets the unknown-space answer", async () => {
    const { t, as, projectId } = await setup();
    as("out");
    const unknown = await read(await t.list(send("GET", "never-existed")));
    expect(unknown).toEqual({ status: 404, body: { code: "NOT_FOUND", message: "Space not found" } });
    expect(await read(await t.list(send("GET", SEED_TEAM_ID)))).toEqual(unknown);
    expect(await read(await t.save(send("POST", SEED_TEAM_ID, { projectId, name: "N" })))).toEqual(unknown);
    expect(await read(await t.get(send("GET", SEED_TEAM_ID), ctx("x")))).toEqual(unknown);
    expect(await read(await t.list(send("GET", null)))).toEqual(unknown);
  });

  it("bad bodies are 400", async () => {
    const { t, projectId } = await setup();
    for (const body of [{ projectId, name: "N", extra: 1 }, { name: "N" }, { projectId, name: 5 }, "{nope"]) {
      expect((await t.save(send("POST", SEED_TEAM_ID, body))).status).toBe(400);
    }
    for (const body of [{}, { name: "N", extra: 1 }, { name: 5 }, "{nope"]) {
      expect((await t.update(send("PATCH", SEED_TEAM_ID, body), ctx("x"))).status).toBe(400);
    }
  });
});
