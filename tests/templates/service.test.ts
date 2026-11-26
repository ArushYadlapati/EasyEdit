import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projects, templates } from "@/db/schema";
import { LIMITS } from "@/lib/limits";
import { createProject, getProject } from "@/lib/projects/service";
import { deleteTemplate, getTemplate, listTemplates, saveTemplate, updateTemplate } from "@/lib/templates/service";
import { personalSpaceId } from "@/lib/spaces/types";
import { DEFAULT_TRANSFORM, isPlaceholder, type Clip } from "@/lib/timeline";
import { updateBrandKit } from "@/lib/brand/service";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const ed = testActor({ userId: "ed", email: "ed@gmail.com", role: "editor" });
const viewer = testActor({ userId: "vi", email: "vi@gmail.com", role: "viewer" });

async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "ed" }, "editor");
  await joinSpace(db, { id: "vi" }, "viewer");
  return db;
}

const video = (id: string, slot?: string): Clip =>
  ({ id, type: "video", assetId: "gone", start: 0, duration: 90, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM }, ...(slot ? { slot: { name: slot } } : {}) }) as Clip;
const text = (id: string, slot?: string): Clip =>
  ({ id, type: "text", start: 0, duration: 90, text: "Hello", transform: { ...DEFAULT_TRANSFORM }, style: { fontFamily: "Geist", fontSize: 64, fontWeight: 600, color: "#fff", align: "center" }, ...(slot ? { slot: { name: slot } } : {}) }) as Clip;

// A project with a slotted video, a slotted title, and a plain image whose asset does not exist.
async function projectWithSlots(db: Awaited<ReturnType<typeof setup>>, name = "P") {
  const { id } = await createProject(db, ed, { name, format: "short_9x16" });
  const p = (await getProject(db, ed, id))!;
  const doc = structuredClone(p.doc);
  doc.tracks[0].clips = [video("v1", "hero"), { ...video("v2"), type: "image" } as Clip];
  doc.tracks[1].clips = [text("t1", "title")];
  await db.update(projects).set({ doc }).where(eq(projects.id, id));
  return id;
}

describe("templates service", () => {
  it("lists starters first, then saved templates by name", async () => {
    const db = await setup();
    const id = await projectWithSlots(db);
    await saveTemplate(db, ed, { projectId: id, name: "Zed" });
    await saveTemplate(db, ed, { projectId: id, name: "alpha" });
    const list = await listTemplates(db, viewer);
    expect(list.map((t) => t.name)).toEqual(["Talking Head", "Product Teaser", "Trip Recap", "Match Recap", "Robot Reveal", "Season Recap", "alpha", "Zed"]);
    expect(list.slice(0, 6).every((t) => t.builtIn)).toBe(true);
    expect(list[6]).toMatchObject({ builtIn: false, format: "short_9x16", width: 1080, height: 1920 });
    expect(list[6].slots.map((s) => s.name)).toEqual(["hero", "title"]);
  });

  it("save turns slot clips into placeholders and keeps a plain clip with a deleted asset", async () => {
    const db = await setup();
    const id = await projectWithSlots(db);
    const saved = await saveTemplate(db, ed, { projectId: id, name: "Mine", description: "d", instructions: "i" });
    expect(saved.replaced).toBe(false);
    const t = (await getTemplate(db, viewer, saved.id))!;
    expect(t).toMatchObject({ name: "Mine", description: "d", instructions: "i", builtIn: false });
    const clips = t.doc.tracks.flatMap((x) => x.clips);
    expect(isPlaceholder(clips.find((c) => c.id === "v1")!)).toBe(true);
    expect(clips.find((c) => c.id === "v2")).toMatchObject({ type: "image", assetId: "gone" });
    expect(clips.find((c) => c.id === "t1")!.type).toBe("text");
  });

  it("a viewer cannot save, update or delete", async () => {
    const db = await setup();
    const id = await projectWithSlots(db);
    await expect(saveTemplate(db, viewer, { projectId: id, name: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { id: tid } = await saveTemplate(db, ed, { projectId: id, name: "X" });
    await expect(updateTemplate(db, viewer, tid, { name: "Y" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteTemplate(db, viewer, tid)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a project without slots, a starter's name, a mixed slot, and a deleted or missing project", async () => {
    const db = await setup();
    const empty = (await createProject(db, ed, { name: "E", format: "short_9x16" })).id;
    await expect(saveTemplate(db, ed, { projectId: empty, name: "T" })).rejects.toMatchObject({ code: "INVALID", message: "Mark at least one clip as a slot first" });
    const id = await projectWithSlots(db);
    await expect(saveTemplate(db, ed, { projectId: id, name: "match recap" })).rejects.toMatchObject({ code: "INVALID", message: "That name belongs to a starter template" });
    await expect(saveTemplate(db, ed, { projectId: id, name: "  " })).rejects.toMatchObject({ code: "INVALID" });
    await expect(saveTemplate(db, ed, { projectId: id, name: "T", description: "x".repeat(LIMITS.templateDescriptionChars + 1) })).rejects.toMatchObject({ code: "INVALID" });
    await expect(saveTemplate(db, ed, { projectId: id, name: "T", instructions: "bad\u0000" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(saveTemplate(db, ed, { projectId: "nope", name: "T" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const p = (await getProject(db, ed, id))!;
    const doc = structuredClone(p.doc);
    doc.tracks[1].clips = [text("t1", "hero")];
    doc.tracks[0].clips = [video("v1", "hero")];
    await db.update(projects).set({ doc }).where(eq(projects.id, id));
    await expect(saveTemplate(db, ed, { projectId: id, name: "T" })).rejects.toMatchObject({ code: "INVALID", message: "hero is used for both text and footage" });
  });

  it("another space cannot read, delete or save from it", async () => {
    const db = await setup();
    const id = await projectWithSlots(db);
    const { id: tid } = await saveTemplate(db, ed, { projectId: id, name: "Mine" });
    await joinSpace(db, { id: "ed" }, "admin", personalSpaceId("ed"));
    const other = testActor({ userId: "ed", email: "ed@gmail.com", role: "admin", spaceId: personalSpaceId("ed") });
    expect(await getTemplate(db, other, tid)).toBeNull();
    expect((await listTemplates(db, other)).map((t) => t.name)).not.toContain("Mine");
    await expect(deleteTemplate(db, other, tid)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveTemplate(db, other, { projectId: id, name: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a duplicate name is a CONFLICT, even in another case; replace keeps the id", async () => {
    const db = await setup();
    const id = await projectWithSlots(db);
    const first = await saveTemplate(db, ed, { projectId: id, name: "Dup", description: "one" });
    await expect(saveTemplate(db, ed, { projectId: id, name: "dup" })).rejects.toMatchObject({ code: "CONFLICT", message: "A template with that name exists" });
    const again = await saveTemplate(db, ed, { projectId: id, name: "dup", description: "two", replace: true });
    expect(again).toEqual({ id: first.id, replaced: true });
    expect(await getTemplate(db, ed, first.id)).toMatchObject({ name: "dup", description: "two" });
    expect(await db.select().from(templates)).toHaveLength(1);
  });

  it("two concurrent saves of one name leave one row", async () => {
    const db = await setup();
    const id = await projectWithSlots(db);
    const results = await Promise.allSettled([
      saveTemplate(db, ed, { projectId: id, name: "Race" }),
      saveTemplate(db, ed, { projectId: id, name: "Race" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(templates)).toHaveLength(1);
  });

  it("update renames and edits text; a clash is CONFLICT; starters are refused", async () => {
    const db = await setup();
    const id = await projectWithSlots(db);
    const a = await saveTemplate(db, ed, { projectId: id, name: "A" });
    await saveTemplate(db, ed, { projectId: id, name: "B" });
    await updateTemplate(db, ed, a.id, { name: "A2", description: "new", instructions: "do it" });
    expect(await getTemplate(db, ed, a.id)).toMatchObject({ name: "A2", description: "new", instructions: "do it" });
    await expect(updateTemplate(db, ed, a.id, { name: "b" })).rejects.toMatchObject({ code: "CONFLICT", message: "A template with that name exists" });
    await expect(updateTemplate(db, ed, a.id, { name: "Robot Reveal" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(updateTemplate(db, ed, "starter-match-recap", { name: "x" })).rejects.toMatchObject({ code: "INVALID", message: "Starter templates can't be changed" });
    await expect(updateTemplate(db, ed, "missing", { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("delete removes the row; starters are refused", async () => {
    const db = await setup();
    const id = await projectWithSlots(db);
    const a = await saveTemplate(db, ed, { projectId: id, name: "A" });
    await deleteTemplate(db, ed, a.id);
    expect(await getTemplate(db, ed, a.id)).toBeNull();
    await expect(deleteTemplate(db, ed, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteTemplate(db, ed, "starter-match-recap")).rejects.toMatchObject({ code: "INVALID", message: "Starter templates can't be deleted" });
  });

  it("a saved template keeps the caption style, the captions switch and the words of kept clips, and drops the others", async () => {
    const db = await setup();
    const id = await projectWithSlots(db);
    const row = (await getProject(db, ed, id))!;
    const doc = structuredClone(row.doc);
    const style = { preset: "bar", fontFamily: "Inter", fontWeight: 800, fontSize: 60, color: "#ffffff", highlight: "#FFD400", y: 0.8, uppercase: true } as const;
    const words = [{ t: "hi", s: 0, e: 100 }];
    // A plain video clip with no slot stays a media clip and keeps its switch and its file's words. The slotted clip
    // of "slotted" becomes an empty slot, so that file's words go.
    doc.tracks[0].clips.push({ ...video("v3"), assetId: "intro", start: 100, captions: true } as Clip, { ...video("v4", "outro"), assetId: "slotted", start: 200 } as Clip);
    doc.captions = { style, transcripts: { intro: words, slotted: words } };
    await db.update(projects).set({ doc }).where(eq(projects.id, id));
    const saved = await saveTemplate(db, ed, { projectId: id, name: "Captioned" });
    const template = (await getTemplate(db, ed, saved.id))!;
    expect(template.doc.captions).toEqual({ style, transcripts: { intro: words } });
    expect(template.doc.tracks[0].clips.find((c) => c.id === "v3")).toMatchObject({ type: "video", captions: true });
  });

  it("refuses a save past the template limit", async () => {
    const db = await setup();
    const id = await projectWithSlots(db);
    const row = (await getProject(db, ed, id))!;
    const { doc } = row;
    await db.insert(templates).values(Array.from({ length: LIMITS.templatesPerSpace }, (_, i) => ({
      id: `t${i}`, spaceId: ed.spaceId, name: `T${i}`, format: "short_9x16" as const, width: 1080, height: 1920, doc, createdBy: "ed", updatedBy: "ed",
    })));
    await expect(saveTemplate(db, ed, { projectId: id, name: "One more" })).rejects.toMatchObject({ code: "INVALID", message: "This space has 100 templates, the most it can keep. Delete one first." });
  });

  it("getTemplate of a starter uses the space's brand fonts", async () => {
    const db = await setup();
    await updateBrandKit(db, ed, { titleFont: "Orbitron" });
    const t = (await getTemplate(db, viewer, "starter-match-recap"))!;
    expect(t.doc.tracks[3].clips[0]).toMatchObject({ style: { fontFamily: "Orbitron" } });
    expect(await getTemplate(db, viewer, "starter-nope")).toBeNull();
  });

  it("createProject from a starter and from a saved template copies doc, format and size", async () => {
    const db = await setup();
    const fromStarter = await createProject(db, ed, { name: "S", format: "long_16x9", templateId: "starter-season-recap" });
    const sp = (await getProject(db, ed, fromStarter.id))!;
    expect(sp.format).toBe("long_16x9");
    expect(sp.doc.tracks.flatMap((t) => t.clips).some(isPlaceholder)).toBe(true);
    const id = await projectWithSlots(db);
    const saved = await saveTemplate(db, ed, { projectId: id, name: "Mine" });
    const made = await createProject(db, ed, { name: "From mine", format: "long_16x9", templateId: saved.id });
    const mp = (await getProject(db, ed, made.id))!;
    expect(mp.format).toBe("short_9x16");
    expect(mp.doc).toEqual((await getTemplate(db, ed, saved.id))!.doc);
    await expect(createProject(db, ed, { name: "X", format: "short_9x16", templateId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Template not found" });
    await expect(createProject(db, ed, { name: " ", format: "short_9x16", templateId: saved.id })).rejects.toMatchObject({ code: "INVALID" });
  });
});
