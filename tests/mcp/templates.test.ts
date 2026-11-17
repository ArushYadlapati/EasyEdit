import { describe, expect, it } from "vitest";
import { createProjectTool } from "@/lib/mcp/tools/create-project";
import { fillTemplateTool, getTemplateTool, listTemplatesTool } from "@/lib/mcp/tools/templates";
import { undoChangeTool } from "@/lib/mcp/tools/undo-change";
import { getProject, createProject } from "@/lib/projects/service";
import { saveTemplate } from "@/lib/templates/service";
import { slotsOf } from "@/lib/timeline";
import { makeTestDb } from "../helpers/db";
import { insertAsset } from "../media/context";
import { toolContext } from "./context";

async function setup(over: Parameters<typeof toolContext>[1] = {}) {
  const db = await makeTestDb();
  const ctx = await toolContext(db, over);
  const team = ctx.spaces.find((s) => s.kind === "team")!;
  const made = await createProject(db, ctx.actor, { name: "Recap", format: "short_9x16", templateId: "starter-match-recap" });
  const fill = (expected_version: number, slots: Parameters<typeof fillTemplateTool>[1]["slots"], project_id = made.id) =>
    fillTemplateTool(ctx, { project_id, expected_version, slots });
  return { db, ctx, team, id: made.id, fill };
}

describe("list_templates", () => {
  it("lists the starters and a saved template, with slots and kinds", async () => {
    const { db, ctx, id } = await setup();
    await saveTemplate(db, ctx.actor, { projectId: id, name: "Our recap", description: "Our own take" });
    const r = await listTemplatesTool(ctx, {});
    expect(r.isError).toBe(false);
    expect(r.text).toContain("starter-match-recap · Match Recap (starter) · ");
    expect(r.text).toContain("slots: music (audio), hero_clip (video or image)");
    expect(r.text).toContain("title_text (text)");
    expect(r.text).toContain("music (audio)");
    expect(r.text).toMatch(/\n[^\s]+ · Our recap · /);
    expect(r.text).toContain("\n  Our own take");
  });

  it("limits to one space, and refuses an unknown one", async () => {
    const { ctx, team } = await setup();
    const one = await listTemplatesTool(ctx, { space: team.slug });
    expect(one.text.match(/^Space /gm)).toHaveLength(1);
    expect((await listTemplatesTool(ctx, { space: "nope" })).isError).toBe(true);
  });
});

describe("get_template", () => {
  it("shows notes, slots with hints and the timeline", async () => {
    const { db, ctx, id } = await setup();
    const saved = await saveTemplate(db, ctx.actor, { projectId: id, name: "Ours", instructions: "Use the best clip first" });
    const r = await getTemplateTool(ctx, { template: saved.id });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Notes for you: Use the best clip first");
    expect(r.text).toContain('hero_clip (video or image) "The best moment');
    expect(r.text).toContain("placeholder(visual)");
  });

  it("reads a starter without a space, and says No template for an unknown id", async () => {
    const { ctx } = await setup();
    expect((await getTemplateTool(ctx, { template: "starter-robot-reveal" })).text).toContain("robot_name (text)");
    const missing = await getTemplateTool(ctx, { template: "nope" });
    expect(missing).toEqual({ text: "No template nope.", isError: true });
  });
});

describe("create_project from a template", () => {
  it("needs a format or a template", async () => {
    const { ctx } = await setup();
    const r = await createProjectTool(ctx, { name: "X", space: "personal" });
    expect(r).toEqual({ text: "Give a format, or a template from list_templates.", isError: true });
  });

  it("starts from a starter and lists the slots to fill", async () => {
    const { ctx, team } = await setup();
    const r = await createProjectTool(ctx, { name: "Worlds", template: "starter-match-recap", space: team.slug });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Slots to fill with fill_template: music (audio), hero_clip (video or image)");
    expect(r.text).toContain("title_text (text)");
  });

  it("an unknown template is refused", async () => {
    const { ctx, team } = await setup();
    const r = await createProjectTool(ctx, { name: "Worlds", template: "nope", space: team.slug });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Template not found");
  });
});

describe("fill_template", () => {
  it("fills text and media in one change, and one undo restores it", async () => {
    const { db, ctx, id, fill } = await setup();
    const asset = await insertAsset(db);
    const r = await fill(0, [{ slot: "title_text", text: "WORLDS" }, { slot: "hero_clip", asset_id: asset, in_seconds: 1 }]);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("version 1");
    expect(r.text).toContain("Filled: title_text, hero_clip.");
    expect(r.text).toMatch(/Still empty: .*highlights/);
    expect(r.text).not.toMatch(/Still empty: .*hero_clip/);
    const project = (await getProject(db, ctx.actor, id))!;
    expect(project.version).toBe(1);
    expect(slotsOf(project.doc).find((s) => s.name === "hero_clip")!.filled).toBe(true);
    const undone = await undoChangeTool(ctx, { project_id: id, expected_version: 1, version: 1 });
    expect(undone.isError).toBe(false);
    const back = (await getProject(db, ctx.actor, id))!;
    expect(slotsOf(back.doc).find((s) => s.name === "hero_clip")!.filled).toBe(false);
    expect(JSON.stringify(back.doc.tracks)).toContain("MATCH RECAP");
  });

  it("answers a repeat of the same call with the same change", async () => {
    const { db, ctx, id, fill } = await setup();
    await fill(0, [{ slot: "title_text", text: "WORLDS" }]);
    const again = await fill(0, [{ slot: "title_text", text: "WORLDS" }]);
    expect(again.isError).toBe(false);
    expect((await getProject(db, ctx.actor, id))!.version).toBe(1);
  });

  it("gives the fill error for the wrong kind", async () => {
    const { db, id, fill } = await setup();
    const audio = await insertAsset(db, { kind: "audio", durationMs: 30_000 });
    const r = await fill(0, [{ slot: "hero_clip", asset_id: audio }]);
    expect(r).toEqual({ text: "hero_clip takes a video or image", isError: true });
    expect((await fill(0, [{ slot: "hero_clip", text: "hi" }])).text).toBe("hero_clip takes a video or image");
    expect((await fill(0, [{ slot: "hero_clip", asset_id: "nope" }])).text).toBe("No media with id nope");
    expect(id).toBeTruthy();
  });

  it("refuses a stale version with the usual answer", async () => {
    const { fill } = await setup();
    await fill(0, [{ slot: "title_text", text: "A" }]);
    const r = await fill(0, [{ slot: "title_text", text: "B" }]);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/version 1/);
  });

  it("is refused for a viewer", async () => {
    const { db, ctx: editor, id } = await setup();
    const viewer = await toolContext(db, { id: "u3", role: "viewer" });
    const r = await fillTemplateTool(viewer, { project_id: id, expected_version: 0, slots: [{ slot: "title_text", text: "A" }] });
    expect(r.isError).toBe(true);
    expect(editor).toBeTruthy();
  });
});
