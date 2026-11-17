import { afterEach, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/lib/access-rules";
import { LIMITS } from "@/lib/limits";
import { makeMoveHandlers } from "@/lib/projects/move-handlers";
import { storageFor } from "@/lib/spaces/storage";
import { forgetAllSources } from "@/lib/storage/token-cache";
import { joinSpace, testUser } from "../helpers/actor";
import { piece } from "../helpers/fake-drive";
import { moveWorld, ORIGIN } from "../projects/move-world";

const post = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const projectCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const moveCtx = (moveId: string) => ({ params: Promise.resolve({ moveId }) });
const copyCtx = (moveId: string, assetId: string) => ({ params: Promise.resolve({ moveId, assetId }) });

async function setup(signedIn: CurrentUser | null = testUser()) {
  const x = await moveWorld();
  let current = signedIn;
  const api = makeMoveHandlers({
    db: () => x.w.db,
    auth: async () => current ?? Response.json({ code: "UNAUTHENTICATED", message: "Sign in" }, { status: 401 }),
    driveFor: (db, id) => storageFor(db, id, x.storage),
    origin: () => ORIGIN,
    storage: x.storage,
  });
  const as = (u: CurrentUser | null) => void (current = u);
  const json = async (res: Response) => ({ status: res.status, body: res.status === 204 ? null : await res.json() });
  const start = async () => {
    const res = await api.start(post("http://x/api/projects/p1/move", { toSpaceId: x.w.personal }), projectCtx("p1"));
    return (await json(res)).body.moveId as string;
  };
  return { x, api, as, json, start };
}

const original = LIMITS.appUploadsPerDay;
afterEach(() => {
  (LIMITS as { appUploadsPerDay: number }).appUploadsPerDay = original;
  forgetAllSources();
});

describe("move routes", () => {
  it("refuses start without a session, for an unseen project, and from another site", async () => {
    const t = await setup(null);
    expect((await t.api.start(post("http://x/m", { toSpaceId: t.x.w.personal }), projectCtx("p1"))).status).toBe(401);
    t.as(testUser());
    expect((await t.api.start(post("http://x/m", { toSpaceId: t.x.w.personal }), projectCtx("nope"))).status).toBe(404);
    await joinSpace(t.x.w.db, { id: "u2" }, "editor", t.x.w.personal);
    t.as(testUser({ id: "u2" }));
    expect((await t.api.start(post("http://x/m", { toSpaceId: t.x.w.personal }), projectCtx("p1"))).status).toBe(404);
    t.as(testUser());
    const cross = await t.api.start(post("http://x/m", { toSpaceId: t.x.w.personal }, { origin: "https://evil.test", host: "x" }), projectCtx("p1"));
    expect(cross.status).toBe(403);
    expect((await t.api.start(post("http://x/m", { nope: 1 }), projectCtx("p1"))).status).toBe(400);
  });

  it("starts a move with 201 and a plan", async () => {
    const t = await setup();
    const res = await t.json(await t.api.start(post("http://x/m", { toSpaceId: t.x.w.personal }), projectCtx("p1")));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ projectId: "p1", to: { id: t.x.w.personal }, items: expect.any(Array) });
  });

  it("moves a whole project through the handlers", async () => {
    const t = await setup();
    const moveId = await t.start();
    // Finishing early names what is missing.
    const early = await t.json(await t.api.finish(post("http://x/f"), moveCtx(moveId)));
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("COPIES_MISSING");
    expect(early.body.missing).toEqual(expect.arrayContaining([t.x.a, t.x.b]));

    for (const source of [t.x.a, t.x.b]) {
      const opened = await t.json(await t.api.openCopy(post("http://x/c", { sourceAssetId: source }), moveCtx(moveId)));
      expect(opened.status).toBe(200);
      const { copyAssetId, uploadUrl, done } = opened.body;
      if (!done) await piece(t.x.w.fake, uploadUrl, 0, 20_000_000, 20_000_000);
      const completed = await t.json(await t.api.completeCopy(post("http://x/c"), copyCtx(moveId, copyAssetId)));
      expect(completed).toMatchObject({ status: 200, body: { assetId: copyAssetId } });
    }
    const done = await t.json(await t.api.finish(post("http://x/f"), moveCtx(moveId)));
    expect(done).toMatchObject({ status: 200, body: { projectId: "p1", spaceId: t.x.w.personal, slug: "personal" } });
  });

  it("opens and completes a copy's preview file", async () => {
    const t = await setup();
    const moveId = await t.start();
    const { body } = await t.json(await t.api.openCopy(post("http://x/c", { sourceAssetId: t.x.a }), moveCtx(moveId)));
    if (!body.done) await piece(t.x.w.fake, body.uploadUrl, 0, 20_000_000, 20_000_000);
    await t.api.completeCopy(post("http://x/c"), copyCtx(moveId, body.copyAssetId));
    const bad = await t.api.openCopyFile(post("http://x/f", { role: "nope", sizeBytes: 5 }), copyCtx(moveId, body.copyAssetId));
    expect(bad.status).toBe(400);
    const opened = await t.json(await t.api.openCopyFile(post("http://x/f", { role: "preview", sizeBytes: 5000 }), copyCtx(moveId, body.copyAssetId)));
    expect(opened.status).toBe(200);
    expect(typeof opened.body.uploadUrl).toBe("string");
    await piece(t.x.w.fake, opened.body.uploadUrl, 0, 5000, 5000);
    const finished = await t.json(await t.api.completeCopyFile(post("http://x/f", { role: "preview" }), copyCtx(moveId, body.copyAssetId)));
    expect(finished).toMatchObject({ status: 200, body: { assetId: body.copyAssetId, hasPreview: true } });
  });

  it("answers someone else's move as not found", async () => {
    const t = await setup();
    const moveId = await t.start();
    await joinSpace(t.x.w.db, { id: "u2" }, "editor");
    t.as(testUser({ id: "u2" }));
    expect((await t.api.finish(post("http://x/f"), moveCtx(moveId))).status).toBe(404);
    expect((await t.api.openCopy(post("http://x/c", { sourceAssetId: t.x.a }), moveCtx(moveId))).status).toBe(404);
    expect((await t.api.abandon(new Request("http://x/m", { method: "DELETE" }), moveCtx(moveId))).status).toBe(404);
  });

  it("limits new copies by the upload budget but lets an existing one reopen", async () => {
    const t = await setup();
    const moveId = await t.start();
    const open = (id: string) => t.api.openCopy(post("http://x/c", { sourceAssetId: id }), moveCtx(moveId));
    expect((await open(t.x.a)).status).toBe(200);
    (LIMITS as { appUploadsPerDay: number }).appUploadsPerDay = 0;
    const refused = await t.json(await open(t.x.b));
    expect(refused).toMatchObject({ status: 429, body: { code: "LIMIT_EXCEEDED" } });
    expect((await open(t.x.a)).status).toBe(200);
  });

  it("abandons with 204, then finish is not found", async () => {
    const t = await setup();
    const moveId = await t.start();
    const res = await t.api.abandon(new Request("http://x/m", { method: "DELETE" }), moveCtx(moveId));
    expect(res.status).toBe(204);
    expect((await t.api.finish(post("http://x/f"), moveCtx(moveId))).status).toBe(404);
  });
});
