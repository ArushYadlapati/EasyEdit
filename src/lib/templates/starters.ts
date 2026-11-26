import type { BrandFonts } from "@/lib/brand/types";
import {
  DEFAULT_FPS,
  FORMAT_PRESETS,
  slotsOf,
  type Clip,
  type PresetId,
  type Track,
  type TrackKind,
  type Transform,
} from "@/lib/timeline";
import type { Template } from "./types";

const at = (x: number, y: number, scale: number, fit: Transform["fit"]): Transform => ({ x, y, scale, rotation: 0, opacity: 1, fit });
const FULL = at(0.5, 0.5, 1, "cover");

type Spec = { name: string; start: number; end: number; hint?: string };
type TextSpec = Spec & { text: string; y: number; title?: boolean };
type LogoSpec = Spec & { y: number; scale: number };

const slot = (s: Spec) => ({ name: s.name, ...(s.hint ? { hint: s.hint } : {}) });
const span = (s: Spec) => ({ start: s.start * DEFAULT_FPS, duration: (s.end - s.start) * DEFAULT_FPS });

function track(kind: TrackKind, name: string, clips: Clip[]): Track {
  return { id: `t-${name.toLowerCase()}`, kind, name, muted: false, hidden: false, locked: false, clips };
}

const music = (end: number): Clip => ({ id: "music", type: "placeholder", accepts: "audio", slot: { name: "music" }, ...span({ name: "music", start: 0, end }), transform: FULL });
const footage = (s: Spec): Clip => ({ id: s.name, type: "placeholder", accepts: "visual", slot: slot(s), ...span(s), transform: FULL });
const logo = (s: LogoSpec): Clip => ({ id: s.name, type: "placeholder", accepts: "visual", slot: slot(s), ...span(s), transform: at(0.5, s.y, s.scale, "contain") });
const title = (fonts: BrandFonts, s: TextSpec): Clip => ({
  id: s.name,
  type: "text",
  slot: slot(s),
  ...span(s),
  text: s.text,
  transform: at(0.5, s.y, 1, "contain"),
  style: s.title
    ? { fontFamily: fonts.title, fontSize: 96, fontWeight: 700, color: "#ffffff", align: "center" }
    : { fontFamily: fonts.body, fontSize: 64, fontWeight: 600, color: "#ffffff", align: "center" },
});

function starter(
  fonts: BrandFonts,
  def: { id: string; name: string; description: string; instructions: string; format: PresetId; seconds: number; footage: Spec[]; logo: LogoSpec; text: TextSpec[] },
): Template {
  const { width, height } = FORMAT_PRESETS[def.format];
  const doc = {
    schemaVersion: 1 as const,
    format: def.format,
    width,
    height,
    fps: DEFAULT_FPS,
    tracks: [
      track("audio", "Music", [music(def.seconds)]),
      track("video", "Footage", def.footage.map(footage)),
      track("overlay", "Logo", [logo(def.logo)]),
      track("text", "Titles", def.text.map((t) => title(fonts, t))),
    ],
  };
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    instructions: def.instructions,
    format: def.format,
    width,
    height,
    builtIn: true,
    slots: slotsOf(doc),
    updatedAt: null,
    doc,
  };
}

export const STARTER_PREFIX = "starter-";

// The general starters come first, for anyone; the robotics ones the app began with follow them.
export function starterTemplates(fonts: BrandFonts): Template[] {
  return [
    starter(fonts, {
      id: "starter-talking-head",
      name: "Talking Head",
      description: "A 30-second video of you talking to the camera, with a hook and a sign-off, for Reels and Shorts.",
      instructions:
        "Use the first seconds of the take, or a striking shot, for hook_clip, the person talking to the camera for talk_clip, and a closing line or a wave for outro_clip. Keep the total length at 30 seconds, put the video's point in a few words in hook_text and what to do next (follow, comment, link in bio) in outro_text.",
      format: "short_9x16",
      seconds: 30,
      footage: [
        { name: "hook_clip", start: 0, end: 3, hint: "The first three seconds: what the video is about" },
        { name: "talk_clip", start: 3, end: 26, hint: "You talking to the camera" },
        { name: "outro_clip", start: 26, end: 30, hint: "A closing line or a wave" },
      ],
      logo: { name: "logo", start: 26, end: 30, y: 0.82, scale: 0.25, hint: "Your logo or channel mark" },
      text: [
        { name: "hook_text", start: 0, end: 3, text: "THE ONE THING TO KNOW", y: 0.2, title: true, hint: "The video's point in a few words" },
        { name: "outro_text", start: 26, end: 30, text: "Follow for more", y: 0.3, hint: "What to do next: follow, comment, link in bio" },
      ],
    }),
    starter(fonts, {
      id: "starter-product-teaser",
      name: "Product Teaser",
      description: "A 20-second teaser for a product, a launch or an event, for Reels and Shorts.",
      instructions:
        "Use close-ups that hint at it without showing it all for teaser_clip, the product or the event shown clearly for reveal_clip, and a strong last shot for closing_shot. Keep the total length at 20 seconds, put its name in headline and a date, a place or where to get it in details_text.",
      format: "short_9x16",
      seconds: 20,
      footage: [
        { name: "teaser_clip", start: 0, end: 6, hint: "Close-ups that hint at it" },
        { name: "reveal_clip", start: 6, end: 15, hint: "The product or the event, shown clearly" },
        { name: "closing_shot", start: 15, end: 20, hint: "A strong last shot" },
      ],
      logo: { name: "brand_logo", start: 15, end: 20, y: 0.8, scale: 0.3, hint: "The brand's or the event's logo" },
      text: [
        { name: "headline", start: 6, end: 9, text: "SOMETHING NEW", y: 0.2, title: true, hint: "The product's or the event's name" },
        { name: "details_text", start: 15, end: 20, text: "Coming soon", y: 0.3, hint: "A date, a place or where to get it" },
      ],
    }),
    starter(fonts, {
      id: "starter-trip-recap",
      name: "Trip Recap",
      description: "A 60-second look back at a trip, a weekend or a week, for YouTube.",
      instructions:
        "Open with the most striking shot for opening_shot, cover the best moments in the order they happened for highlights, and end on a calm or happy last shot for last_shot. Keep the total length at 60 seconds, put where and when in trip_title and a sign-off in outro_text.",
      format: "long_16x9",
      seconds: 60,
      footage: [
        { name: "opening_shot", start: 0, end: 6, hint: "The most striking shot of the trip" },
        { name: "highlights", start: 6, end: 50, hint: "The best moments, in the order they happened" },
        { name: "last_shot", start: 50, end: 60, hint: "A calm or happy last shot" },
      ],
      logo: { name: "channel_logo", start: 50, end: 60, y: 0.85, scale: 0.2, hint: "Your logo or channel mark" },
      text: [
        { name: "trip_title", start: 0, end: 5, text: "OUR TRIP", y: 0.5, title: true, hint: "Where and when, e.g. Three days in Lisbon" },
        { name: "outro_text", start: 50, end: 60, text: "Thanks for watching", y: 0.15 },
      ],
    }),
    starter(fonts, {
      id: "starter-match-recap",
      name: "Match Recap",
      description: "A 30-second recap of one match for Reels and Shorts.",
      instructions:
        "Pick the best moment for hero_clip, the strongest back-to-back moments for highlights, and the end of the match or the team celebrating for final_moment. Keep the total length at 30 seconds and fill title_text and score_text with the event, match and final score.",
      format: "short_9x16",
      seconds: 30,
      footage: [
        { name: "hero_clip", start: 0, end: 8, hint: "The best moment: a big score or a close finish" },
        { name: "highlights", start: 8, end: 24, hint: "More good moments, back to back" },
        { name: "final_moment", start: 24, end: 30, hint: "The end of the match or the team celebrating" },
      ],
      logo: { name: "sponsor_logo", start: 24, end: 30, y: 0.82, scale: 0.25, hint: "A sponsor's or the team's logo" },
      text: [
        { name: "title_text", start: 0, end: 3, text: "MATCH RECAP", y: 0.2, title: true, hint: "Event and match, e.g. Qualifier · Match 12" },
        { name: "score_text", start: 24, end: 30, text: "FINAL 0 – 0", y: 0.3 },
      ],
    }),
    starter(fonts, {
      id: "starter-robot-reveal",
      name: "Robot Reveal",
      description: "A 20-second reveal of the team's robot for Reels and Shorts.",
      instructions:
        "Use close-ups that hide the full robot for teaser, the whole robot in action for reveal_clip, and a strong last shot for closing_shot. Keep the total length at 20 seconds and put the robot's name in robot_name.",
      format: "short_9x16",
      seconds: 20,
      footage: [
        { name: "teaser", start: 0, end: 5, hint: "Close-ups that hide the full robot" },
        { name: "reveal_clip", start: 5, end: 15, hint: "The whole robot in action" },
        { name: "closing_shot", start: 15, end: 20, hint: "A strong last shot of the robot" },
      ],
      logo: { name: "team_logo", start: 15, end: 20, y: 0.8, scale: 0.3, hint: "The team's logo" },
      text: [
        { name: "robot_name", start: 5, end: 8, text: "MEET OUR ROBOT", y: 0.2, title: true, hint: "The robot's name" },
        { name: "tagline", start: 15, end: 20, text: "See you at the next event", y: 0.3 },
      ],
    }),
    starter(fonts, {
      id: "starter-season-recap",
      name: "Season Recap",
      description: "A 90-second look back at the whole season for YouTube.",
      instructions:
        "Open with the best clip of the season for intro_clip, cover the season's events in order for highlights, and use a team photo for team_photo. Keep the total length at 90 seconds and thank the sponsors in thanks_text.",
      format: "long_16x9",
      seconds: 90,
      footage: [
        { name: "intro_clip", start: 0, end: 10, hint: "The best clip of the season" },
        { name: "highlights", start: 10, end: 75, hint: "The season's events, in order" },
        { name: "team_photo", start: 75, end: 90, hint: "A team photo or the team together" },
      ],
      logo: { name: "sponsor_logos", start: 75, end: 90, y: 0.85, scale: 0.2, hint: "The sponsors' logos" },
      text: [
        { name: "season_title", start: 0, end: 5, text: "OUR SEASON", y: 0.5, title: true, hint: "The season's name or year" },
        { name: "thanks_text", start: 75, end: 90, text: "Thank you to our sponsors", y: 0.15 },
      ],
    }),
  ];
}
