import { describe, expect, it } from "vitest";
import { starterTemplates } from "@/lib/templates/starters";
import { DEFAULT_FPS, TimelineDoc, mixedSlots, slotsOf } from "@/lib/timeline";

const fonts = { title: "Orbitron", subtitle: "Inter", body: "Roboto" };
const byId = (id: string) => starterTemplates(fonts).find((t) => t.id === id)!;

describe("starter templates", () => {
  it("has the three starters, all valid docs with no mixed slots", () => {
    const all = starterTemplates(fonts);
    expect(all.map((t) => t.id)).toEqual(["starter-match-recap", "starter-robot-reveal", "starter-season-recap"]);
    for (const t of all) {
      expect(TimelineDoc.safeParse(t.doc).success).toBe(true);
      expect(mixedSlots(t.doc)).toEqual([]);
      expect(t.builtIn).toBe(true);
      expect(t.updatedAt).toBeNull();
      expect(t.slots).toEqual(slotsOf(t.doc));
      expect(t.instructions.length).toBeGreaterThan(20);
    }
  });

  it("match recap: format, slots, times", () => {
    const t = byId("starter-match-recap");
    expect([t.format, t.width, t.height]).toEqual(["short_9x16", 1080, 1920]);
    expect(t.doc.tracks.map((x) => [x.kind, x.name])).toEqual([["audio", "Music"], ["video", "Footage"], ["overlay", "Logo"], ["text", "Titles"]]);
    expect(t.slots.map((s) => [s.name, s.kind, s.filled])).toEqual([
      ["music", "audio", false], ["hero_clip", "visual", false], ["highlights", "visual", false], ["final_moment", "visual", false],
      ["sponsor_logo", "visual", false], ["title_text", "text", true], ["score_text", "text", true],
    ]);
    const clips = Object.fromEntries(t.doc.tracks.flatMap((x) => x.clips).map((c) => [c.id, c]));
    expect([clips.music.start, clips.music.duration]).toEqual([0, 30 * DEFAULT_FPS]);
    expect([clips.highlights.start, clips.highlights.duration]).toEqual([8 * DEFAULT_FPS, 16 * DEFAULT_FPS]);
    expect(clips.sponsor_logo.transform).toMatchObject({ x: 0.5, y: 0.82, scale: 0.25, fit: "contain" });
    expect(clips.title_text).toMatchObject({ type: "text", text: "MATCH RECAP", style: { fontFamily: "Orbitron", fontSize: 96, fontWeight: 700, color: "#ffffff", align: "center" } });
    expect(clips.score_text).toMatchObject({ text: "FINAL 0 – 0", style: { fontFamily: "Roboto", fontSize: 64, fontWeight: 600 } });
  });

  it("robot reveal and season recap", () => {
    const r = byId("starter-robot-reveal");
    expect(r.slots.map((s) => s.name)).toEqual(["music", "teaser", "reveal_clip", "closing_shot", "team_logo", "robot_name", "tagline"]);
    expect(r.doc.tracks[3].clips[0].duration).toBe(3 * DEFAULT_FPS);
    const s = byId("starter-season-recap");
    expect([s.format, s.width]).toEqual(["long_16x9", 1920]);
    expect(s.slots.map((x) => x.name)).toEqual(["music", "intro_clip", "highlights", "team_photo", "sponsor_logos", "season_title", "thanks_text"]);
    expect(s.doc.tracks[3].clips[0]).toMatchObject({ style: { fontFamily: "Orbitron" } });
  });
});
