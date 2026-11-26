import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projectVersions, projects } from "@/db/schema";
import { LIMITS } from "@/lib/limits";
import { applyProjectOps, createProject, getProject } from "@/lib/projects/service";
import { REVIEW_LIMITS, REVIEW_MESSAGES, openedName, versionName } from "@/lib/review/rules";
import { deleteVersion, listVersions, openVersion, renameVersion, saveVersion } from "@/lib/review/versions";
import { personalSpaceId } from "@/lib/spaces/types";
import { DEFAULT_TRANSFORM } from "@/lib/timeline";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "ben", name: "Ben" }, "editor");
  await joinSpace(db, { id: "cy", name: "Cy" }, "viewer");
  await joinSpace(db, { id: "dee", name: "Dee" }, "admin", personalSpaceId("dee"));
  const ben = testActor({ userId: "ben", role: "editor" });
  const cy = testActor({ userId: "cy", role: "viewer" });
  const dee = testActor({ userId: "dee", role: "admin", spaceId: personalSpaceId("dee") });
  const project = (await createProject(db, ben, { name: "Reveal", format: "short_9x16" })).id;
  return { db, ben, cy, dee, project };
}
const refusal = async (work: Promise<unknown>) => work.then(() => null, (error: { code?: string; status?: number; message: string }) => [error.code, error.status, error.message]);
// One edit: a title on the project's text track.
async function addTitle(db: Awaited<ReturnType<typeof setup>>["db"], actor: ReturnType<typeof testActor>, project: string, text: string) {
  const record = (await getProject(db, actor, project))!;
  const track = record.doc.tracks.find((t) => t.kind === "text")!;
  const start = track.clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);
  await applyProjectOps(db, actor, {
    projectId: project,
    baseVersion: record.version,
    ops: [{ op: "add_clip", trackId: track.id, clip: { id: `t${record.version}`, type: "text", start, duration: 30, text, transform: { ...DEFAULT_TRANSFORM }, style: { fontFamily: "Geist", fontSize: 60, fontWeight: 700, color: "#ffffff", align: "center" } } }],
  });
}
const titles = (doc: { tracks: { clips: { type: string; text?: string }[] }[] }) => doc.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text").map((c) => c.text);

describe("names", () => {
  it("are one trimmed line of up to 80 characters", () => {
    expect(versionName("  Rough \n cut  ")).toBe("Rough cut");
    expect(versionName("x".repeat(80))).toHaveLength(80);
    for (const bad of ["", "   ", "x".repeat(81), 3, null]) expect(versionName(bad)).toBeNull();
  });
  it("of the project a version opens as fit a project's name", () => {
    expect(openedName("Reveal", "Rough cut", 100)).toBe("Reveal (Rough cut)");
    expect(openedName("R".repeat(100), "Rough cut", 100)).toBe(`${"R".repeat(88)} (Rough cut)`);
    expect(openedName("Reveal", "v".repeat(80), 60)).toBe("Reveal copy");
  });
});

describe("saving a version", () => {
  it("keeps the timeline as it is now, and later edits don't change it", async () => {
    const { db, ben, cy, project } = await setup();
    await addTitle(db, ben, project, "One");
    const { id } = await saveVersion(db, ben, project, " Rough cut ");
    await addTitle(db, ben, project, "Two");
    expect(await listVersions(db, cy, project)).toMatchObject([{ id, name: "Rough cut", version: 1, by: "Ben", stale: false }]);
    const [kept] = await db.select({ doc: projectVersions.doc }).from(projectVersions).where(eq(projectVersions.id, id));
    expect(titles(kept.doc)).toEqual(["One"]);
    expect(titles((await getProject(db, ben, project))!.doc)).toEqual(["One", "Two"]);
  });
  it("lists the newest first", async () => {
    const { db, ben, project } = await setup();
    await saveVersion(db, ben, project, "First");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveVersion(db, ben, project, "Second");
    expect((await listVersions(db, ben, project)).map((v) => v.name)).toEqual(["Second", "First"]);
  });
  it("is for editors, needs a name, and stops at twenty", async () => {
    const { db, ben, cy, dee, project } = await setup();
    expect((await refusal(saveVersion(db, cy, project, "Mine")))?.slice(0, 2)).toEqual(["FORBIDDEN", 403]);
    expect((await refusal(saveVersion(db, dee, project, "Mine")))?.slice(0, 2)).toEqual(["NOT_FOUND", 404]);
    expect(await refusal(saveVersion(db, ben, project, "  "))).toEqual(["INVALID", 400, REVIEW_MESSAGES.nameEmpty]);
    for (let i = 0; i < REVIEW_LIMITS.versionsPerProject; i++) await saveVersion(db, ben, project, `v${i}`);
    expect(await refusal(saveVersion(db, ben, project, "One more"))).toEqual(["CONFLICT", 409, REVIEW_MESSAGES.versionsFull]);
    expect(await listVersions(db, ben, project)).toHaveLength(REVIEW_LIMITS.versionsPerProject);
  });
});

describe("renaming and deleting", () => {
  it("are for editors, and say so when the version is gone", async () => {
    const { db, ben, cy, project } = await setup();
    const { id } = await saveVersion(db, ben, project, "Rough cut");
    expect((await refusal(renameVersion(db, cy, project, id, "x")))?.slice(0, 2)).toEqual(["FORBIDDEN", 403]);
    expect((await refusal(deleteVersion(db, cy, project, id)))?.slice(0, 2)).toEqual(["FORBIDDEN", 403]);
    await renameVersion(db, ben, project, id, "Fine cut");
    expect((await listVersions(db, ben, project))[0].name).toBe("Fine cut");
    expect(await refusal(renameVersion(db, ben, project, id, ""))).toEqual(["INVALID", 400, REVIEW_MESSAGES.nameEmpty]);
    await deleteVersion(db, ben, project, id);
    expect(await listVersions(db, ben, project)).toEqual([]);
    expect(await refusal(deleteVersion(db, ben, project, id))).toEqual(["NOT_FOUND", 404, REVIEW_MESSAGES.versionGone]);
    expect(await refusal(renameVersion(db, ben, project, id, "x"))).toEqual(["NOT_FOUND", 404, REVIEW_MESSAGES.versionGone]);
  });
});

describe("opening a version", () => {
  it("makes a new project beside the first, with the timeline as it was kept, and leaves the first alone", async () => {
    const { db, ben, project } = await setup();
    await addTitle(db, ben, project, "One");
    const { id } = await saveVersion(db, ben, project, "Rough cut");
    await addTitle(db, ben, project, "Two");
    const opened = await openVersion(db, ben, project, id);
    const copy = (await getProject(db, ben, opened.id))!;
    expect([copy.name, copy.version, copy.format, titles(copy.doc)]).toEqual(["Reveal (Rough cut)", 0, "short_9x16", ["One"]]);
    expect(copy.name.length).toBeLessThanOrEqual(LIMITS.projectNameChars);
    expect(titles((await getProject(db, ben, project))!.doc)).toEqual(["One", "Two"]);
    const [row] = await db.select({ width: projects.width, height: projects.height, spaceId: projects.spaceId }).from(projects).where(eq(projects.id, opened.id));
    expect(row).toEqual({ width: 1080, height: 1920, spaceId: ben.spaceId });
  });
  it("is for editors, and never reaches a version through another project", async () => {
    const { db, ben, cy, project } = await setup();
    const { id } = await saveVersion(db, ben, project, "Rough cut");
    expect((await refusal(openVersion(db, cy, project, id)))?.slice(0, 2)).toEqual(["FORBIDDEN", 403]);
    const other = (await createProject(db, ben, { name: "Other", format: "short_9x16" })).id;
    expect(await refusal(openVersion(db, ben, other, id))).toEqual(["NOT_FOUND", 404, REVIEW_MESSAGES.versionGone]);
  });
  it("refuses a version saved before the project moved to this space", async () => {
    const { db, ben, project } = await setup();
    const { id } = await saveVersion(db, ben, project, "Before the move");
    await db.execute(sql`update projects set version = 5, moved_at_version = 5 where id = ${project}`);
    const after = await saveVersion(db, ben, project, "After the move");
    expect((await listVersions(db, ben, project)).map((v) => [v.name, v.stale])).toEqual(expect.arrayContaining([["Before the move", true], ["After the move", false]]));
    expect(await refusal(openVersion(db, ben, project, id))).toEqual(["CONFLICT", 409, REVIEW_MESSAGES.versionStale]);
    expect((await openVersion(db, ben, project, after.id)).id).toBeTruthy();
  });
  it("goes when its project is deleted for good", async () => {
    const { db, ben, project } = await setup();
    await saveVersion(db, ben, project, "Rough cut");
    await db.execute(sql`delete from projects where id = ${project}`);
    expect(await db.select().from(projectVersions)).toEqual([]);
  });
});
