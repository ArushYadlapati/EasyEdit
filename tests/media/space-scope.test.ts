import { describe, expect, it } from "vitest";
import { createMediaApi } from "@/lib/media/api";
import { removeAsset } from "@/lib/media/service";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { applyProjectOps, createProject, getProject } from "@/lib/projects/service";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import type { OpInput } from "@/lib/timeline";
import { joinSpace, testActor } from "../helpers/actor";
import { IMAGE, VIDEO, handlersFetch, insertAsset, mediaClip, mediaContext } from "./context";

// Ada is in Seattle Solvers and has a personal space; Grace is in the team only.
async function setup() {
  const ctx = await mediaContext();
  await joinSpace(ctx.db, { id: ctx.ada.userId, email: ctx.ada.email }, "admin", personalSpaceId(ctx.ada.userId));
  const adaPersonal = testActor({ userId: ctx.ada.userId, email: ctx.ada.email, role: "admin", spaceId: personalSpaceId(ctx.ada.userId) });
  return { ctx, adaPersonal };
}

const call = async (fetchFn: typeof fetch, method: string, path: string, body?: unknown) => {
  const response = await fetchFn(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
};

describe("media is scoped to a space", () => {
  it("asset from another space is refused in ops and routes", async () => {
    const { ctx, adaPersonal } = await setup();
    const otherId = await insertAsset(ctx.db, { spaceId: adaPersonal.spaceId, uploadedBy: ctx.ada.userId });
    const { id: projectId } = await createProject(ctx.db, ctx.ada, { name: "Recap", format: "short_9x16" });
    const add = { op: "add_clip", trackId: "v1", clip: mediaClip(otherId, { id: "c1" }) } as OpInput;
    await expect(applyProjectOps(ctx.db, ctx.ada, { projectId, baseVersion: 0, ops: [add] })).rejects.toMatchObject({
      code: "INVALID",
      message: `add_clip (op 0): asset "${otherId}" is not in the library`,
    });
    expect((await getProject(ctx.db, ctx.ada, projectId))!.version).toBe(0);

    // A team member who is not in that personal space gets the answer an unknown id gets, byte for byte.
    const grace = handlersFetch(ctx, ctx.grace);
    for (const [method, suffix, body] of [["PATCH", "", { name: "x" }], ["DELETE", "", undefined], ["POST", "/offset", undefined], ["POST", "/complete", undefined], ["POST", "/preview-failed", undefined]] as const) {
      const other = await call(grace, method, `/api/media/${otherId}${suffix}`, body);
      const unknown = await call(grace, method, `/api/media/never-existed${suffix}`, body);
      expect(other, `${method}${suffix}`).toEqual(unknown);
      expect(other.status).toBe(404);
    }
    // And the owner, from the team's point of view, cannot reach it through the team either.
    expect((await call(handlersFetch(ctx, ctx.ada), "GET", `/api/media?space=${SEED_TEAM_ID}&ids=${otherId}`)).body).toMatchObject({ assets: [] });
  });

  it("a space without storage lists nothing and refuses uploads", async () => {
    const { ctx, adaPersonal } = await setup();
    await insertAsset(ctx.db, { spaceId: adaPersonal.spaceId, uploadedBy: ctx.ada.userId });
    const ada = handlersFetch(ctx, ctx.ada);
    const space = adaPersonal.spaceId;
    const listed = await call(ada, "GET", `/api/media?space=${space}`);
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ assets: [{ name: "IMG_4821" }], setUp: false }); // what the space holds is still listed
    const empty = await call(handlersFetch(ctx, ctx.grace), "GET", `/api/media?space=${(await setupEmptyPersonal(ctx)).spaceId}`);
    expect(empty.body).toMatchObject({ assets: [], setUp: false });
    const refused = { status: 409, body: { code: "STORAGE_NOT_SET_UP", message: expect.any(String) } };
    expect(await call(ada, "POST", `/api/media?space=${space}`, VIDEO)).toEqual(refused);
    expect(await call(ada, "POST", `/api/drive/read-token?space=${space}`)).toEqual(refused);
    // The client factory puts the space on its collection calls.
    const api = createMediaApi(space, ada);
    expect(await api.open(IMAGE)).toMatchObject({ ok: false, kind: "not-set-up" });
    expect(await api.readToken()).toMatchObject({ ok: false, kind: "not-set-up" });
    expect(await createMediaApi(SEED_TEAM_ID, ada).open(IMAGE)).toMatchObject({ ok: true });
  });

  it("read-token needs membership of the space", async () => {
    const { ctx, adaPersonal } = await setup();
    const grace = handlersFetch(ctx, ctx.grace);
    const unknown = await call(grace, "POST", "/api/drive/read-token?space=no-such-space");
    expect(unknown.status).toBe(404);
    expect(await call(grace, "POST", `/api/drive/read-token?space=${adaPersonal.spaceId}`)).toEqual(unknown); // not a member
    expect(await call(grace, "POST", "/api/drive/read-token")).toEqual(unknown); // names no space
    expect(await call(grace, "GET", `/api/media?space=${adaPersonal.spaceId}`)).toEqual(unknown);
    expect(await call(grace, "POST", `/api/media?space=${adaPersonal.spaceId}`, VIDEO)).toEqual(unknown);
    expect((await call(grace, "POST", `/api/drive/read-token?space=${SEED_TEAM_ID}`)).status).toBe(200);
  });

  it("used-by ignores projects in other spaces", async () => {
    const { ctx, adaPersonal } = await setup();
    const assetId = await insertAsset(ctx.db, { uploadedBy: ctx.ada.userId });
    const { id } = await createProject(ctx.db, adaPersonal, { name: "Elsewhere", format: "short_9x16" });
    // A clip of the team's asset in a personal project, written straight to the row.
    const doc = (await getProject(ctx.db, adaPersonal, id))!.doc as unknown as { tracks: { clips: unknown[] }[] };
    doc.tracks[0].clips.push(mediaClip(assetId, { id: "c1" }));
    await ctx.db.update(projects).set({ doc: doc as never }).where(eq(projects.id, id));
    await removeAsset(ctx.deps, ctx.ada, assetId); // not "used in 1 project"
    await expect(removeAsset(ctx.deps, ctx.ada, assetId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

async function setupEmptyPersonal(ctx: Awaited<ReturnType<typeof mediaContext>>) {
  await joinSpace(ctx.db, { id: ctx.grace.userId, email: ctx.grace.email }, "admin", personalSpaceId(ctx.grace.userId));
  return { spaceId: personalSpaceId(ctx.grace.userId) };
}
