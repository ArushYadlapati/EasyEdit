import { describe, expect, it } from "vitest";
import { assetTranscripts } from "@/db/schema";
import { editTimelineTool } from "@/lib/mcp/tools/edit-timeline";
import { createProject, getProject } from "@/lib/projects/service";
import { captionTrack, type CaptionWord, type OpInput } from "@/lib/timeline";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { makeTestDb } from "../helpers/db";
import { insertAsset, mediaClip } from "../media/context";
import { toolContext } from "./context";

const WORDS: CaptionWord[] = [{ t: "hello", s: 0, e: 400 }, { t: "world", s: 500, e: 900 }];

async function setup(opts: { saved?: boolean } = { saved: true }) {
  const db = await makeTestDb();
  const ctx = await toolContext(db);
  const asset = await insertAsset(db, { name: "talk" });
  if (opts.saved) await db.insert(assetTranscripts).values({ assetId: asset, spaceId: SEED_TEAM_ID, words: WORDS, model: "m", createdBy: "u1" });
  const { id } = await createProject(db, ctx.actor, { name: "Recap", format: "short_9x16" });
  const edit = (expected: number, ops: unknown[]) => editTimelineTool(ctx, { project_id: id, expected_version: expected, ops });
  const project = async () => (await getProject(db, ctx.actor, id))!;
  return { db, ctx, asset, id, edit, project };
}

const addVideo = (asset: string, extra: Record<string, unknown> = {}) => ({ op: "add_clip", trackId: "v1", clip: mediaClip(asset, { id: "m1", ...extra }) });

describe("edit_timeline: turning captions on", () => {
  it("brings in the file's saved words and the Captions track, ahead of the caller's ops", async () => {
    const x = await setup();
    expect((await x.edit(0, [addVideo(x.asset)])).isError).toBe(false);
    const result = await x.edit(1, [{ op: "update_clip", clipId: "m1", patch: { captions: true } }]);
    expect(result.isError).toBe(false);
    expect(result.text.split("\n").slice(0, 2)).toEqual([`Brought in saved captions for ${x.asset}.`, "Applied 3 ops as version 2."]);
    const { doc } = await x.project();
    expect(doc.captions?.transcripts).toEqual({ [x.asset]: WORDS });
    expect(captionTrack(doc)).toBeDefined();
    expect(doc.tracks[0].clips[0]).toMatchObject({ captions: true });
  });

  it("does the same for an added clip that starts with captions on", async () => {
    const x = await setup();
    const result = await x.edit(0, [addVideo(x.asset, { captions: true })]);
    expect(result.isError).toBe(false);
    const { doc } = await x.project();
    expect(doc.captions?.transcripts?.[x.asset]).toEqual(WORDS);
    expect(captionTrack(doc)).toBeDefined();
  });

  it("brings in the saved words for an added caption clip, and the clip shows them", async () => {
    const x = await setup();
    await x.edit(0, [addVideo(x.asset), { op: "add_track", track: { id: "cap1", kind: "caption", name: "Captions" } }]);
    const result = await x.edit(1, [{ op: "add_clip", trackId: "cap1", clip: { id: "k1", type: "caption", assetId: x.asset, start: 0, duration: 30, transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, fit: "contain" } } }]);
    expect(result.isError).toBe(false);
    expect(result.text.split("\n")[0]).toBe(`Brought in saved captions for ${x.asset}.`);
    const { doc } = await x.project();
    expect(doc.captions?.transcripts?.[x.asset]).toEqual(WORDS);
    expect(captionTrack(doc)!.clips.map((c) => c.id)).toEqual(["k1"]);
  });

  it("only adds the words, when the track is already there", async () => {
    const x = await setup();
    await x.edit(0, [addVideo(x.asset), { op: "add_track", track: { kind: "caption", name: "Captions" } }]);
    const result = await x.edit(1, [{ op: "update_clip", clipId: "m1", patch: { captions: true } }]);
    expect(result.text.split("\n").slice(0, 2)).toEqual([`Brought in saved captions for ${x.asset}.`, "Applied 2 ops as version 2."]);
    expect((await x.project()).doc.tracks.filter((t) => t.kind === "caption")).toHaveLength(1);
  });

  it("adds nothing when the document already has the words and the track", async () => {
    const x = await setup();
    await x.edit(0, [addVideo(x.asset, { captions: true })]);
    const off = await x.edit(1, [{ op: "update_clip", clipId: "m1", patch: { captions: false } }]);
    expect(off.text).not.toContain("Brought in");
    expect(off.text.split("\n")[0]).toBe("Applied 1 op as version 2.");
    const on = await x.edit(2, [{ op: "update_clip", clipId: "m1", patch: { captions: true } }]);
    expect(on.text.split("\n")[0]).toBe("Applied 1 op as version 3."); // the words are already in the document
  });

  it("refuses the whole call when a file has no saved words", async () => {
    const x = await setup({ saved: false });
    await x.edit(0, [addVideo(x.asset)]);
    const result = await x.edit(1, [{ op: "update_clip", clipId: "m1", patch: { captions: true } }, { op: "set_format", format: "long_16x9" }]);
    expect(result.isError).toBe(true);
    expect(result.text).toBe(`No saved captions for ${x.asset}. Ask a person to open the project and press Auto captions in the Captions tab; then try again.`);
    const p = await x.project();
    expect(p.version).toBe(1);
    expect(p.doc.captions).toBeUndefined();
  });

  it("leaves a call that does not touch captions exactly as before", async () => {
    const x = await setup();
    const result = await x.edit(0, [addVideo(x.asset)]);
    expect(result.text.split("\n")[0]).toBe("Applied 1 op as version 1.");
    const p = await x.project();
    expect(p.doc.captions).toBeUndefined();
    expect(captionTrack(p.doc)).toBeUndefined();
  });

  it("keeps the version rule: a stale expected_version gets the normal conflict and nothing is added", async () => {
    const x = await setup();
    await x.edit(0, [addVideo(x.asset)]);
    const result = await x.edit(0, [{ op: "update_clip", clipId: "m1", patch: { captions: true } } as OpInput]);
    expect(result.isError).toBe(true);
    expect(result.text.split("\n")[0]).toBe("Edit refused: the project changed after version 0. It is now at version 1. Nothing was applied.");
    expect((await x.project()).version).toBe(1);
  });

  it("a repeat of a call that already landed answers with the first answer", async () => {
    const x = await setup();
    await x.edit(0, [addVideo(x.asset)]);
    const ops = [{ op: "update_clip", clipId: "m1", patch: { captions: true } }];
    const first = await x.edit(1, ops);
    const again = await x.edit(1, ops);
    // The repeat has nothing to bring in, so it is the first answer without its note.
    expect(again.text).toBe(first.text.split("\n").slice(1).join("\n"));
    expect((await x.project()).version).toBe(2);
  });
});
