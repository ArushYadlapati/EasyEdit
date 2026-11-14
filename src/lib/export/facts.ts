import { graphemes } from "@/lib/text";
import type { TimelineDoc } from "@/lib/timeline";
import type { ClipPlan, ExportMediaPlan } from "./media-sources";
import { AUDIO, type ExportPresetId, type ExportSize, type VideoSettings } from "./presets";

// What the export dialog says about the file before and while it is made: its largest size, its name, the time
// left, what it will hold, and why it cannot start yet.

// The largest the file should get: both tracks at their full bitrate for the whole length.
export function maxBytes(video: VideoSettings, totalFrames: number): number {
  return Math.ceil(((video.bitrate + AUDIO.bitrate) * totalFrames) / video.fps / 8);
}

// Counted in thousands, as file managers do.
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.ceil(bytes / 1_000))} KB`;
  if (bytes < 10_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

const NAME_GRAPHEMES = 80;

// The project's name as every file system accepts it: no reserved or control characters, no runs of spaces, no
// spaces at either end, no dots at the end, at most 80 characters.
function cleanName(projectName: string): string {
  const cleaned = projectName
    .replace(/[\\/:*?\x22<>|\p{Cc}]/gu, " ") // \x22 is the double quote
    .replace(/ {2,}/g, " ")
    .trim()
    .replace(/\.+$/, "");
  return graphemes(cleaned).slice(0, NAME_GRAPHEMES).join("") || "Untitled";
}

const PRESET_SUFFIX: Record<ExportPresetId, string> = { project: "", "1080p": " (1080p)", draft: " (draft)" };

export function exportFileName(projectName: string, preset: ExportPresetId): string {
  return `${cleanName(projectName)}${PRESET_SUFFIX[preset]}.mp4`;
}

export function frameFileName(projectName: string, frame: number): string {
  return `${cleanName(projectName)} frame ${String(frame).padStart(6, "0")}.png`;
}

// Null until a frame is done and a second has passed, so the first guess is not wild.
export function secondsLeft(framesDone: number, totalFrames: number, elapsedMs: number): number | null {
  if (framesDone <= 0 || elapsedMs < 1_000) return null;
  return ((totalFrames - framesDone) * elapsedMs) / framesDone / 1_000;
}

export function timeLeftLabel(seconds: number | null): string {
  if (seconds === null) return "";
  if (seconds < 5) return "A few seconds left";
  if (seconds <= 55) return `About ${Math.ceil(seconds / 5) * 5} seconds left`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "About 1 minute left" : `About ${minutes} minutes left`;
}

type Matches = (clip: ClipPlan) => boolean;

const countOf = (plan: ExportMediaPlan, matches: Matches) => Object.values(plan.clips).filter(matches).length;

// Each clip once, whether its picture, its sound or both match: a visible video is in both plans.
const clipsEither = (plan: ExportMediaPlan, matches: Matches) => {
  const ids = new Set<string>();
  for (const plans of [plan.clips, plan.sounds]) {
    for (const [id, clip] of Object.entries(plans)) if (matches(clip)) ids.add(id);
  }
  return ids.size;
};

// What the person should know before exporting at this size. audio: this browser can encode AAC.
export function exportNotes(plan: ExportMediaPlan, size: ExportSize, audio: boolean): string[] {
  const notes: string[] = [];
  const placeholders = countOf(plan, (clip) => clip.kind === "placeholder");
  if (placeholders === 1) notes.push("1 clip has no media to show, so it exports as the placeholder in the preview.");
  else if (placeholders > 1) notes.push(`${placeholders} clips have no media to show, so they export as the placeholders in the preview.`);
  const fromCopies = countOf(plan, (clip) => clip.kind === "use" && clip.from === "preview") > 0;
  if (Math.min(size.width, size.height) > 720 && fromCopies) notes.push("Video clips export from their 720p preview copies.");
  if (audio) {
    // A clip the line above counts is not counted again for its sound.
    const silent = Object.entries(plan.sounds)
      .filter(([id, clip]) => clip.kind === "placeholder" && plan.clips[id]?.kind !== "placeholder").length;
    if (silent === 1) notes.push("1 sound clip has no media, so it exports silent, as in the preview.");
    else if (silent > 1) notes.push(`${silent} sound clips have no media, so they export silent, as in the preview.`);
  } else if (plan.soundClips > 0) {
    notes.push("This browser can't add sound to the file, so it will have no sound track. To include the sound, export in Chrome or Edge on a Mac or Windows computer.");
  }
  return notes;
}

// Why Export is off for now; null when nothing waits.
export function waitingReason(plan: ExportMediaPlan): string | null {
  const preparing = clipsEither(plan, (clip) => clip.kind === "wait" && (clip.why === "uploading" || clip.why === "preparing"));
  if (preparing === 1) return "1 clip uses media that is still uploading or being prepared. Export once it's ready.";
  if (preparing > 1) return `${preparing} clips use media that is still uploading or being prepared. Export once it's ready.`;
  if (clipsEither(plan, (clip) => clip.kind === "wait" && clip.why === "library") > 0) return "Checking the media library…";
  return null;
}

// Equal values under equal keys at every depth, whatever the order of the keys. A key whose value is undefined
// counts as absent, as it is once the project is stored.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameValue(item, b[i]));
  }
  const entriesOf = (value: object) => Object.entries(value).filter(([, v]) => v !== undefined);
  const left = entriesOf(a);
  const right = new Map(entriesOf(b));
  return left.length === right.size && left.every(([key, value]) => right.has(key) && sameValue(value, right.get(key)));
}

// The same content, whatever the order of keys: the editor replaces its doc object when an edit is confirmed even
// when nothing changed, and the database returns keys in its own order. A safe area is a guide over the preview and is
// never drawn, so it is no change to the file.
export function sameDoc(a: TimelineDoc, b: TimelineDoc): boolean {
  return sameValue({ ...a, safeAreas: undefined }, { ...b, safeAreas: undefined });
}
