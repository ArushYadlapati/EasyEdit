import { AGENT_KINDS } from "@/lib/connector/agents";
import { agentLabel, UNKNOWN_AGENT_LABEL } from "@/lib/projects/display-actor";
import { formatLabel, type Clip, type Op, type TimelineDoc } from "@/lib/timeline";
import { timeAgo } from "@/lib/time-ago";
import type { ProjectApi } from "./api";
import { sameOps } from "./reconcile";
import type { EditorStore } from "./store";
import { ACTIVITY_LIMIT, type ActivityEntry } from "./types";

// How long the editing indicator stays up after someone else's change.
export const EDITING_INDICATOR_MS = 6000;
// How many changes the activity list loads at a time.
export const ACTIVITY_PAGE = 50;

type OpOf<K extends Op["op"]> = Extract<Op, { op: K }>;

const count = (n: number, one: string, many: (n: number) => string) => (n === 1 ? one : many(n));

const TRACK_FLAG_SUMMARY: Record<"locked" | "hidden" | "muted", [on: string, off: string]> = {
  locked: ["Locked a track", "Unlocked a track"],
  hidden: ["Hid a track", "Showed a track"],
  muted: ["Muted a track", "Unmuted a track"],
};

function summarizeTrackUpdates(ops: OpOf<"update_track">[]): string {
  if (ops.length === 1) {
    const entries = Object.entries(ops[0].patch).filter(([, v]) => v !== undefined);
    if (entries.length === 1) {
      const [key, value] = entries[0];
      if (key === "name") return "Renamed a track";
      const flag = TRACK_FLAG_SUMMARY[key as keyof typeof TRACK_FLAG_SUMMARY];
      if (flag) return value ? flag[0] : flag[1];
    }
  }
  const tracks = new Set(ops.map((o) => o.trackId)).size;
  return count(tracks, "Changed a track", (n) => `Changed ${n} tracks`);
}

export type ClipKind = Clip["type"];
// Says what kind of clip an id is, when that is known.
export type KindOf = (clipId: string) => ClipKind | undefined;

const KIND_NOUN: Record<ClipKind, string> = { text: "text", video: "a video clip", image: "an image", audio: "an audio clip", placeholder: "an empty slot", shape: "a shape", adjustment: "an adjustment layer", nest: "a nest" };
const nounFor = (kind: ClipKind | undefined) => (kind ? KIND_NOUN[kind] : "a clip");

// What a row can say about one clip besides its kind: its words or its file's name, else the name of its track.
export type ClipAbout = { name?: string; track?: string };
export type AboutOf = (clipId: string) => ClipAbout | undefined;

const NAME_MAX = 32;

// “Summer trip”, on one line, cut at NAME_MAX characters.
function quoted(name: string): string {
  const line = name.replace(/\s+/g, " ").trim();
  return `“${line.length > NAME_MAX ? `${line.slice(0, NAME_MAX - 1).trimEnd()}…` : line}”`;
}

const MEDIA_KINDS = new Set<ClipKind | undefined>(["video", "image", "audio"]);

// text “Summer trip”, “beach.mp4”, a shape on Shapes, a clip.
function clipPhrase(kind: ClipKind | undefined, about: ClipAbout | undefined): string {
  const name = about?.name?.trim();
  if (name && kind === "text") return `text ${quoted(name)}`;
  if (name && MEDIA_KINDS.has(kind)) return quoted(name);
  return about?.track ? `${nounFor(kind)} on ${about.track}` : nounFor(kind);
}

// What an update_clip patch touches, in the order it is listed.
const ASPECTS: [name: string, touched: (patch: Record<string, unknown>) => boolean][] = [
  ["wording", (p) => "text" in p],
  ["font", (p) => has(p.style, "fontFamily")],
  ["size", (p) => has(p.style, "fontSize")],
  ["weight", (p) => has(p.style, "fontWeight")],
  ["color", (p) => has(p.style, "color")],
  ["alignment", (p) => has(p.style, "align")],
  ["position", (p) => has(p.transform, "x") || has(p.transform, "y")],
  ["scale", (p) => has(p.transform, "scale")],
  ["stretch", (p) => has(p.transform, "stretch")],
  ["rotation", (p) => has(p.transform, "rotation")],
  ["opacity", (p) => has(p.transform, "opacity")],
  ["fit", (p) => has(p.transform, "fit")],
  ["crop", (p) => has(p.transform, "crop")],
  ["source", (p) => "assetId" in p],
  ["start point", (p) => "in" in p],
  ["speed", (p) => "speed" in p],
  ["volume", (p) => "volume" in p],
];

function has(part: unknown, key: string): boolean {
  return typeof part === "object" && part !== null && key in part;
}

// "position", "position and scale", "position, scale and rotation", "position, scale, rotation and more".
function listed(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(", ")} and more`;
}

// "Changed text: wording and color", "Changed a video clip: scale", "Changed 2 clips: position". With aboutOf, the clip
// is named ("Changed “beach.mp4”: volume"), and new words alone read "Changed text to “Summer trip”".
function summarizeClipUpdates(ops: OpOf<"update_clip">[], kindOf: KindOf, aboutOf?: AboutOf): string {
  const clips = new Set(ops.map((o) => o.clipId));
  const aspects = ASPECTS.filter(([, touched]) => ops.some((o) => touched(o.patch))).map(([name]) => name);
  if (aspects.length === 0) return count(clips.size, "Edited a clip", (k) => `Edited ${k} clips`);
  if (clips.size > 1) return `Changed ${clips.size} clips: ${listed(aspects)}`;
  // Only text has wording and a text style, so a patch that touches them names its own kind.
  const isText = ops.some((o) => "text" in o.patch || "style" in o.patch);
  const kind = kindOf(ops[0].clipId) ?? (isText ? "text" : undefined);
  if (!aboutOf) return `Changed ${nounFor(kind)}: ${listed(aspects)}`;
  const words = ops.findLast((o) => typeof o.patch.text === "string")?.patch.text;
  if (aspects.length === 1 && aspects[0] === "wording" && typeof words === "string" && words.trim() !== "") return `Changed text to ${quoted(words)}`;
  return `Changed ${clipPhrase(kind, aboutOf(ops[0].clipId))}: ${listed(aspects)}`;
}

// A clip switch and nothing else: { captions: true } or { captions: false }.
const captionSwitch = (op: Op, on: boolean) => op.op === "update_clip" && Object.keys(op.patch).length === 1 && op.patch.captions === on;

// Auto captions, or captions switched on by hand: only caption ops and clips switched on, with words or a clip
// switched on among them. Words alone are "Changed the captions" (Transcribe again, or an agent's fix).
function addsCaptions(ops: Op[]): boolean {
  const fits = (op: Op) =>
    (op.op === "add_track" && op.track.kind === "caption") || op.op === "set_caption_style" || op.op === "set_transcript" || captionSwitch(op, true);
  if (!ops.every(fits)) return false;
  return ops.some((op) => captionSwitch(op, true)) || (ops.some((op) => op.op === "set_transcript" && op.words !== null) && ops.some((op) => op.op !== "set_transcript"));
}

// A short line for the activity list saying what a batch of ops did. With kindOf, a change to one clip names its kind;
// with aboutOf too, it names the clip itself, by its words or its file's name, or else its track.
export function summarizeOps(ops: Op[], kindOf: KindOf = () => undefined, aboutOf?: AboutOf): string {
  const fallback = `Made ${ops.length} changes`;
  if (ops.length === 0) return fallback;
  const kinds = new Set(ops.map((o) => o.op));
  const only = (kind: Op["op"]) => kinds.size === 1 && kinds.has(kind);
  const n = ops.length;

  // Tracks added to hold new clips are part of adding the clips.
  if (kinds.has("add_clip") && [...kinds].every((k) => k === "add_clip" || k === "add_track")) {
    const adds = ops.filter((o): o is OpOf<"add_clip"> => o.op === "add_clip");
    if (adds.length > 1) return `Added ${adds.length} clips`;
    const added = adds[0].clip;
    if (added.type === "placeholder") return `Added slot ${added.slot.name}`;
    return `Added ${aboutOf ? clipPhrase(added.type, aboutOf(added.id)) : nounFor(added.type)}`;
  }
  if (addsCaptions(ops)) return "Added captions";
  if (ops.every((op) => captionSwitch(op, false))) return "Removed captions";
  const one = (verb: string) => {
    const clipId = (ops[0] as { clipId: string }).clipId;
    return `${verb} ${aboutOf ? clipPhrase(kindOf(clipId), aboutOf(clipId)) : nounFor(kindOf(clipId))}`;
  };
  if (only("remove_clip")) return count(n, one("Deleted"), (k) => `Deleted ${k} clips`);
  if (only("move_clip")) return count(n, one("Moved"), (k) => `Moved ${k} clips`);
  if (only("trim_clip")) return count(n, one("Trimmed"), (k) => `Trimmed ${k} clips`);
  if (only("split_clip")) return count(n, one("Split"), (k) => `Split ${k} clips`);
  if (only("update_clip")) return summarizeClipUpdates(ops as OpOf<"update_clip">[], kindOf, aboutOf);
  if (only("update_track")) return summarizeTrackUpdates(ops as OpOf<"update_track">[]);
  if (only("add_track")) return count(n, "Added a track", (k) => `Added ${k} tracks`);
  if (only("remove_track")) return count(n, "Removed a track", (k) => `Removed ${k} tracks`);
  if (only("move_track")) return "Reordered tracks";
  if (only("replace_track")) {
    const restored = ops.every((o) => o.op === "replace_track" && o.restore === true);
    return restored
      ? count(n, "Restored a track", (k) => `Restored ${k} tracks`)
      : count(n, "Replaced a track", (k) => `Replaced ${k} tracks`);
  }
  if (only("set_format") && n === 1) {
    return `Changed the format to ${formatLabel(ops[0] as OpOf<"set_format">)}`;
  }
  if (only("set_safe_area") && n === 1) {
    const { size } = ops[0] as OpOf<"set_safe_area">;
    return size ? `Resized the safe area to ${wholePercent(size.width)} × ${wholePercent(size.height)}` : "Reset the safe area";
  }
  if (only("add_guide")) return count(n, "Added a guide", (k) => `Added ${k} guides`);
  if (only("move_guide")) return count(n, "Moved a guide", (k) => `Moved ${k} guides`);
  if (only("remove_guide")) return count(n, "Removed a guide", (k) => `Removed ${k} guides`);
  if (only("add_marker")) return count(n, "Added a marker", (k) => `Added ${k} markers`);
  if (only("update_marker")) return count(n, "Changed a marker", (k) => `Changed ${k} markers`);
  if (only("remove_marker")) return count(n, "Removed a marker", (k) => `Removed ${k} markers`);
  if (only("add_lut")) return count(n, "Added a LUT", (k) => `Added ${k} LUTs`);
  if (only("remove_lut")) return count(n, "Removed a LUT", (k) => `Removed ${k} LUTs`);
  if (ops.some((o) => o.op === "add_lut") && ops.every((o) => o.op === "add_lut" || o.op === "update_clip")) return "Imported a LUT";
  if (ops.some((o) => o.op === "remove_lut") && ops.every((o) => o.op === "remove_lut" || o.op === "update_clip")) return "Removed a LUT";
  if (only("set_caption_style")) return "Changed the caption style";
  if (only("set_transcript")) return "Changed the captions";
  if (only("splice_caption_words")) return "Edited caption words";
  return summarizeMixed(ops) ?? fallback;
}

const MIXED_GROUPS: { match: (op: Op["op"]) => boolean; one: string; many: (n: number) => string }[] = [
  { match: (k) => k === "add_clip", one: "added a clip", many: (n) => `added ${n} clips` },
  { match: (k) => k === "remove_clip", one: "deleted a clip", many: (n) => `deleted ${n} clips` },
  { match: (k) => k === "move_clip", one: "moved a clip", many: (n) => `moved ${n} clips` },
  { match: (k) => k === "trim_clip", one: "trimmed a clip", many: (n) => `trimmed ${n} clips` },
  { match: (k) => k === "split_clip", one: "split a clip", many: (n) => `split ${n} clips` },
  { match: (k) => k === "update_clip", one: "edited a clip", many: (n) => `edited ${n} clips` },
  { match: (k) => k.endsWith("_track"), one: "changed tracks", many: () => "changed tracks" },
  { match: (k) => k === "set_format", one: "changed the format", many: () => "changed the format" },
  { match: (k) => k === "set_safe_area", one: "changed the safe area", many: () => "changed the safe area" },
  { match: (k) => k.endsWith("_guide"), one: "changed guides", many: () => "changed guides" },
  { match: (k) => k === "set_caption_style", one: "changed the caption style", many: () => "changed the caption style" },
  { match: (k) => k === "set_transcript", one: "changed the captions", many: () => "changed the captions" },
  { match: (k) => k === "splice_caption_words", one: "edited caption words", many: () => "edited caption words" },
];

// 0.88 → "88%"; a typed 0.875 → "87.5%".
function wholePercent(fraction: number): string {
  return `${Number((fraction * 100).toFixed(1))}%`;
}

// "A", "A and B", "A, B and C", "A, B, C and more", with the first letter capitalised.
function summarizeMixed(ops: Op[]): string | null {
  const parts = MIXED_GROUPS.flatMap((g) => {
    const n = ops.filter((o) => g.match(o.op)).length;
    return n === 0 ? [] : [count(n, g.one, g.many)];
  });
  if (parts.length === 0) return null;
  const text =
    parts.length === 1 ? parts[0]
    : parts.length === 2 ? `${parts[0]} and ${parts[1]}`
    : parts.length === 3 ? `${parts[0]}, ${parts[1]} and ${parts[2]}`
    : `${parts[0]}, ${parts[1]}, ${parts[2]} and more`;
  return text[0].toUpperCase() + text.slice(1);
}

// True when the log kept an inverse for this change, so it can be undone.
export function canUndoChange(entry: ActivityEntry): entry is ActivityEntry & { inverse: Op[] } {
  return entry.inverse !== null && entry.inverse.length > 0;
}

// A change made before the project's last move to another space. Its undo could name media the old space kept, so it
// has none, whatever the list loaded.
export function isBeforeMove(entry: ActivityEntry, movedAtVersion: number | null): boolean {
  return movedAtVersion !== null && entry.version < movedAtVersion;
}

// The move's own change: it points the clips at their copies in this space, and has no undo.
export function isMoveEntry(entry: Pick<ActivityEntry, "version" | "inverse">, movedAtVersion: number | null): boolean {
  return entry.version === movedAtVersion && entry.inverse === null;
}

export const MOVED_HERE = "Moved here from another space";
export const MADE_BEFORE_MOVE = "Made before the move";

export function whoLabel(entry: ActivityEntry, meId: string): string {
  return entry.actor === meId ? "You" : entry.actorName;
}

// The log names an AI agent "<agent>" or "<agent> (for <name>)", as in "Claude (for Ada)"; both show as the agent.
const AGENT_LABELS = [...new Set([...AGENT_KINDS.map(agentLabel), UNKNOWN_AGENT_LABEL])];

function withoutMember(name: string): string {
  const agent = AGENT_LABELS.find((label) => name === label || (name.startsWith(`${label} (for `) && name.endsWith(")")));
  return agent ?? name;
}

export function editingLabel(names: string[]): string | null {
  const people = [...new Set(names.map(withoutMember))];
  if (people.length === 0) return null;
  if (people.length === 1) return `${people[0]} is editing…`;
  return `${people.length} people are editing…`;
}

// The newest page of the log, ending at version.
export function recentRange(version: number): { since: number; limit: number } | null {
  if (version <= 0) return null;
  const since = Math.max(0, version - ACTIVITY_PAGE);
  return { since, limit: version - since };
}

// The page just before the oldest loaded version.
export function olderRange(oldestLoaded: number): { since: number; limit: number } | null {
  if (oldestLoaded <= 1) return null;
  const end = oldestLoaded - 1;
  const since = Math.max(0, end - ACTIVITY_PAGE);
  return { since, limit: end - since };
}

// beforeMove: made before the project's last move, so it says so in place of its Undo. undone: a later change in the
// list undid this one, so it says so in place of its Undo. clipIds: the clips the change touched that are still in the
// project, which the row can select.
export type ActivityRow = {
  version: number;
  who: string;
  summary: string;
  when: string;
  canUndo: boolean;
  beforeMove: boolean;
  undone: boolean;
  clipIds: string[];
};

// The kind of every clip a change adds or brings back (its own ops, or the stored undo of a delete).
function kindsIn(ops: Op[] | null, into: Map<string, ClipKind>): void {
  for (const op of ops ?? []) {
    if (op.op === "add_clip") into.set(op.clip.id, op.clip.type);
    else if (op.op === "replace_track") for (const clip of op.track.clips) into.set(clip.id, clip.type);
  }
}

// A clip's words (text) or its file's name (media), as the list can know them.
function clipName(clip: Clip, assetName: (assetId: string) => string | undefined): string | undefined {
  if (clip.type === "text") return clip.text;
  if (clip.type === "video" || clip.type === "image" || clip.type === "audio") return assetName(clip.assetId);
  return undefined;
}

// What a change adds or brings back says what its clips are called and where they sit.
function aboutIn(ops: Op[] | null, doc: TimelineDoc | undefined, assetName: (assetId: string) => string | undefined, into: Map<string, ClipAbout>) {
  const trackName = (trackId: string) => doc?.tracks.find((t) => t.id === trackId)?.name;
  for (const op of ops ?? []) {
    if (op.op === "add_clip") into.set(op.clip.id, { name: clipName(op.clip, assetName), track: trackName(op.trackId) });
    else if (op.op === "replace_track") for (const clip of op.track.clips) into.set(clip.id, { name: clipName(clip, assetName), track: op.track.name });
  }
}

// Every clip a change names.
export function touchedClipIds(ops: Op[]): string[] {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.op === "add_clip") ids.add(op.clip.id);
    else if (op.op === "replace_track") for (const clip of op.track.clips) ids.add(clip.id);
    else if ("clipId" in op && typeof op.clipId === "string") ids.add(op.clipId);
    if (op.op === "split_clip") ids.add(op.newClipId);
  }
  return [...ids];
}

// Which loaded change undid which: an undo, from Activity or from the Undo button, sends the earlier change's stored
// inverse, so a change whose ops are an earlier change's inverse undid it. undid maps each such change to the version
// it undid; undone holds the versions whose effect is undone now. Redo is an undo of an undo, so it brings the first
// change back.
export function undoLinks(entries: ActivityEntry[]): { undid: Map<number, number>; undone: Set<number> } {
  const undid = new Map<number, number>();
  const undone = new Set<number>();
  entries.forEach((entry, i) => {
    for (let j = i - 1; j >= 0; j--) {
      const earlier = entries[j];
      if (undone.has(earlier.version) || !earlier.inverse || earlier.inverse.length !== entry.ops.length) continue;
      if (!sameOps(earlier.inverse, entry.ops)) continue;
      undid.set(entry.version, earlier.version);
      undone.add(earlier.version);
      const first = undid.get(earlier.version);
      if (first !== undefined) undone.delete(first);
      return;
    }
  });
  return { undid, undone };
}

export type ActivityContext = {
  doc?: TimelineDoc; // the project as the server holds it: names what is still there
  movedAtVersion?: number | null; // the version of the project's last move
  assetName?: (assetId: string) => string | undefined; // a media file's name, from the library
};

// The loaded entries as list rows, newest first. With the project, a change to one clip names it. With the version of
// the project's last move, the move reads as one and the changes before it cannot be undone. An undo reads "Undid: …"
// and the change it undid is marked undone; undoing an undo reads "Redid: …".
export function activityRows(entries: ActivityEntry[], meId: string, now: Date, context: ActivityContext = {}): ActivityRow[] {
  const { doc, movedAtVersion = null, assetName = () => undefined } = context;
  const kinds = new Map<string, ClipKind>();
  const about = new Map<string, ClipAbout>();
  for (const entry of entries) {
    kindsIn(entry.ops, kinds);
    kindsIn(entry.inverse, kinds);
    aboutIn(entry.ops, doc, assetName, about);
    aboutIn(entry.inverse, doc, assetName, about);
  }
  const inDoc = new Set<string>();
  for (const track of doc?.tracks ?? []) {
    for (const clip of track.clips) {
      kinds.set(clip.id, clip.type);
      about.set(clip.id, { name: clipName(clip, assetName), track: track.name });
      inDoc.add(clip.id);
    }
  }
  const kindOf: KindOf = (clipId) => kinds.get(clipId);
  const aboutOf: AboutOf = (clipId) => about.get(clipId);
  const byVersion = new Map(entries.map((e) => [e.version, e]));
  const { undid, undone } = undoLinks(entries);

  const summaryOf = (entry: ActivityEntry): string => (isMoveEntry(entry, movedAtVersion) ? MOVED_HERE : summarizeOps(entry.ops, kindOf, aboutOf));
  // "Undid: Added a shape", "Undid: Added a shape (Theo's)", "Redid: Added a shape".
  const undoSummary = (entry: ActivityEntry, target: ActivityEntry): string => {
    const first = undid.get(target.version);
    const original = first !== undefined ? byVersion.get(first) : undefined;
    const [verb, what] = original ? ["Redid", original] : ["Undid", target];
    const owner = what.actor === entry.actor ? "" : what.actor === meId ? " (yours)" : ` (${what.actorName}'s)`;
    return `${verb}: ${summaryOf(what)}${owner}`;
  };

  return entries
    .map((entry) => {
      const beforeMove = isBeforeMove(entry, movedAtVersion);
      const target = byVersion.get(undid.get(entry.version) ?? -1);
      const isUndone = undone.has(entry.version);
      return {
        version: entry.version,
        who: whoLabel(entry, meId),
        summary: target ? undoSummary(entry, target) : summaryOf(entry),
        when: timeAgo(new Date(entry.createdAt), now),
        canUndo: canUndoChange(entry) && !beforeMove && !isUndone,
        beforeMove,
        undone: isUndone && !beforeMove,
        clipIds: touchedClipIds(entry.ops).filter((id) => inDoc.has(id)),
      };
    })
    .reverse();
}

// True when earlier changes can still be loaded: the oldest loaded version is above 1 and the list is not full.
export function hasOlderActivity(entries: ActivityEntry[]): boolean {
  return entries.length > 0 && entries.length < ACTIVITY_LIMIT && entries[0].version > 1;
}

// Reads a range of the log. A page can be cut short by size, so it asks again from where the
// last page ended until the range is covered. Null when a request failed.
async function fetchRange(api: ProjectApi, range: { since: number; limit: number }): Promise<ActivityEntry[] | null> {
  const end = range.since + range.limit;
  const entries: ActivityEntry[] = [];
  let since = range.since;
  for (;;) {
    const page = await api.getOpsSince(since, end - since);
    if (!page.ok) return null;
    entries.push(...page.entries);
    if (!page.hasMore || page.version >= end || page.version <= since) return entries;
    since = page.version;
  }
}

async function loadRange(api: ProjectApi, store: EditorStore, range: { since: number; limit: number } | null): Promise<boolean> {
  if (!range) return true;
  const entries = await fetchRange(api, range);
  if (!entries) return false;
  store.getState().loadActivity(entries);
  return true;
}

// Loads the newest page of the log. False: the request failed.
export function loadRecentActivity(api: ProjectApi, store: EditorStore): Promise<boolean> {
  return loadRange(api, store, recentRange(store.getState().server.version));
}

// Loads the page before the oldest loaded change. False: the request failed.
export function loadOlderActivity(api: ProjectApi, store: EditorStore): Promise<boolean> {
  const { activity } = store.getState();
  const range = activity.length === 0 || !hasOlderActivity(activity) ? null : olderRange(activity[0].version);
  return loadRange(api, store, range);
}
