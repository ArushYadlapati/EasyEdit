import { docCues } from "@/lib/captions/cues";
import { graphemes } from "@/lib/text";
import { ADJUST_KEYS, isAdjusted } from "./adjust";
import { captionStyleOf } from "./captions";
import { NO_STRETCH, docDuration, isCropped, safeAreaOf, stretchOf } from "./presets";
import { KEYFRAME_PROPS } from "./keyframes";
import { nestClips, nestLength } from "./nest";
import { shapeToolOf } from "./shapes";
import { TEXT_EXTRA_KEYS, TEXT_STYLE_DEFAULTS } from "./text-style";
import { isColorClip } from "./types";
import type { Clip, Emphasis, Grade, Keyframe, KeyframeProp, MediaClip, NestClip, ShapeClip, Slot, TextStyle, Track, TimelineDoc, Transform, Transition } from "./types";

const TEXT_PREVIEW_CHARS = 40;

export function framesToSeconds(f: number, fps: number): string {
  return (f / fps).toFixed(2);
}

const ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

export function escapeQuoted(text: string): string {
  return text.replace(/[\\"\n\r\t\u2028\u2029]/g, (ch) => ESCAPES[ch]);
}

function describeText(text: string): string {
  const flat = text.replace(/\r\n|\r|\n/g, " ");
  const chars = graphemes(flat);
  const shown = chars.length > TEXT_PREVIEW_CHARS ? `${chars.slice(0, TEXT_PREVIEW_CHARS).join("")}…` : flat;
  return escapeQuoted(shown);
}

// " slot=name" and, when there is one, the hint in quotes. Empty for a clip with no slot, so older docs read the same.
function slotSuffix(slot: Slot | undefined): string {
  if (!slot) return "";
  return ` slot=${slot.name}${slot.hint ? ` "${describeText(slot.hint)}"` : ""}`;
}

// The words inside these tokens are enum values and hex colours, never user text, so they need no escaping.
function transitionToken(t: Transition): string {
  const detail = t.kind === "slide" || t.kind === "whip" ? `-${t.direction ?? "left"}` : t.kind === "dip" ? `-${t.color ?? "#000000"}` : "";
  return `${t.kind}${detail}`;
}

// The preset, then what it is set to apart from its own look: a highlight's colour, or a shake's or pulse's amount and
// speed (factors, as update_clip takes them; 1 is left out).
function emphasisToken(e: Emphasis): string {
  if (e.preset === "highlight_word") return `${e.preset} ${e.color ?? "#FFD400"}`;
  let out: string = e.preset;
  if ((e.amount ?? 1) !== 1) out += ` amount ${e.amount}`;
  if ((e.speed ?? 1) !== 1) out += ` speed ${e.speed}`;
  return out;
}

// One property's keyframes, at:value~ease each, so a list can be patched back whole with only one keyframe changed.
// Linear, the default, is left out.
function keyframeList(clip: Clip, prop: KeyframeProp): string {
  const keys = clip.keyframes?.[prop] ?? [];
  // A hand-shaped curve is its four numbers, as a patch gives them in `curve`.
  const shape = (k: Keyframe) => (k.curve && k.ease !== "hold" ? `~curve(${k.curve.join(" ")})` : k.ease && k.ease !== "linear" ? `~${k.ease}` : "");
  return keys.map((k) => `${k.at}:${Number(k.value.toFixed(4))}${shape(k)}`).join(",");
}

// A grade's parts that change the picture, as the JSON an update_clip patch takes: a wheel off its rest, a curve with
// points, a look-up table's id and how much of it when that is not all.
function gradeToken(grade: Grade | undefined): string {
  if (!grade) return "";
  const set: Record<string, unknown> = {};
  for (const key of ["lift", "gamma", "gain"] as const) {
    const wheel = grade[key];
    if (wheel && (wheel.x !== 0 || wheel.y !== 0 || wheel.level !== 0)) set[key] = wheel;
  }
  for (const key of ["curve", "curveR", "curveG", "curveB"] as const) if ((grade[key]?.length ?? 0) > 0) set[key] = grade[key];
  if (grade.lut != null) {
    set.lut = grade.lut;
    if ((grade.lutAmount ?? 1) !== 1) set.lutAmount = grade.lutAmount;
  }
  return Object.keys(set).length > 0 ? ` grade=${JSON.stringify(set)}` : "";
}

function describeEffects(clip: Clip, fps: number, detail: boolean): string {
  let out = "";
  if (clip.type === "text") {
    if (clip.animationIn) out += ` anim-in=${clip.animationIn.preset} ${framesToSeconds(clip.animationIn.frames, fps)}s`;
    if (clip.animationOut) out += ` anim-out=${clip.animationOut.preset} ${framesToSeconds(clip.animationOut.frames, fps)}s`;
    if (clip.emphasis) out += ` emphasis=${emphasisToken(clip.emphasis)}`;
    // The stretches of its words with a look of their own, as update_clip takes them.
    if (detail && clip.spans && clip.spans.length > 0) out += ` spans=${JSON.stringify(clip.spans)}`;
  } else if (clip.type !== "adjustment") {
    if (clip.transitionIn) out += ` in=${transitionToken(clip.transitionIn)} ${framesToSeconds(clip.transitionIn.frames, fps)}s`;
    if (clip.transitionOut) out += ` out=${transitionToken(clip.transitionOut)} ${framesToSeconds(clip.transitionOut.frames, fps)}s`;
  }
  if ((clip.type === "video" || clip.type === "audio") && clip.sound) {
    const set = Object.entries(clip.sound).filter(([, value]) => value !== 0 && value !== false).map(([key, value]) => `"${key}":${value}`);
    if (set.length > 0) out += ` sound={${set.join(",")}}`;
  }
  if (isColorClip(clip) && isAdjusted(clip.adjust)) {
    const set = ADJUST_KEYS.filter((key) => (clip.adjust?.[key] ?? 0) !== 0).map((key) => `"${key}":${clip.adjust![key]}`);
    out += ` adjust={${set.join(",")}}`;
  }
  if (isColorClip(clip)) out += gradeToken(clip.grade);
  if (clip.type !== "placeholder" && clip.type !== "adjustment" && clip.blend && clip.blend !== "normal") out += ` blend=${clip.blend}`;
  if ((clip.type === "video" || clip.type === "image") && (clip.rounding ?? 0) > 0) out += ` rounding=${clip.rounding}`;
  if ((clip.type === "video" || clip.type === "image") && clip.chroma) out += ` chroma=${JSON.stringify(clip.chroma)}`;
  if (isColorClip(clip) && clip.mask) out += ` mask=${JSON.stringify(clip.mask)}`;
  // Steadied: said, with how much larger it is drawn; the moves themselves are of no use to read.
  if (clip.type === "video" && clip.steady) out += ` steady(zoom ${clip.steady.zoom})`;
  if (clip.group) out += ` group=${escapeQuoted(clip.group)}`;
  const keyed = KEYFRAME_PROPS.filter((p) => (clip.keyframes?.[p]?.length ?? 0) > 0);
  if (detail) for (const p of keyed) out += ` kf.${p}=${keyframeList(clip, p)}`;
  else if (keyed.length > 0) out += ` kf=${keyed.join(",")}`;
  return out;
}

// Every shape field that is set, as JSON-ish key=value pairs an update_clip patch can copy.
function describeShape(clip: ShapeClip): string {
  const keys = ["shape", "width", "height", "stroke", "strokeWidth", "dash", "fill", "radius", "heads", "head", "headSize", "bend", "points"] as const;
  return keys
    .filter((k) => clip[k] !== undefined && !(clip.shape === "arrow" && k === "height"))
    .map((k) => `${k}=${typeof clip[k] === "number" ? clip[k] : JSON.stringify(clip[k])}`)
    .join(" ");
}

// A sound fade is only worth a word when the clip has one, in frames as update_clip takes them.
function fadeSuffix(clip: MediaClip): string {
  return `${(clip.fadeIn ?? 0) > 0 ? ` fadeIn=${clip.fadeIn}` : ""}${(clip.fadeOut ?? 0) > 0 ? ` fadeOut=${clip.fadeOut}` : ""}`;
}

function describeClip(clip: Clip, fps: number): string {
  const range = `${framesToSeconds(clip.start, fps)}–${framesToSeconds(clip.start + clip.duration, fps)}s`;
  // The slot comes before the effects, on every kind of clip.
  if (clip.type === "placeholder") {
    return `  ${clip.id}  placeholder(${clip.accepts})  ${range}  ${slotSuffix(clip.slot).trimStart()}${describeEffects(clip, fps, false)}`;
  }
  if (clip.type === "text") {
    return `  ${clip.id}  text  ${range}  "${describeText(clip.text)}"${slotSuffix(clip.slot)}${describeEffects(clip, fps, false)}`;
  }
  if (clip.type === "shape") {
    return `  ${clip.id}  shape(${shapeToolOf(clip)})  ${range}  ${clip.stroke ?? clip.fill ?? ""}${describeEffects(clip, fps, false)}`;
  }
  // An adjustment layer changes everything under it; its opacity is how much.
  if (clip.type === "adjustment") return `  ${clip.id}  adjustment  ${range}  amount=${clip.transform.opacity}${describeEffects(clip, fps, false)}`;
  // A nest is several clips as one; what it holds is listed with the project's details.
  if (clip.type === "nest") return `  ${clip.id}  nest  ${range}  ${nestSummary(clip, fps)}${describeEffects(clip, fps, false)}`;
  // Captions of one file, shown while it lasts.
  if (clip.type === "caption") return `  ${clip.id}  caption  ${range}  asset=${clip.assetId}`;
  return `  ${clip.id}  ${clip.type}  ${range}  asset=${clip.assetId} in=${framesToSeconds(clip.in, fps)}s speed=${clip.speed} vol=${clip.volume}${fadeSuffix(clip)}${captionsSuffix(clip)}${slotSuffix(clip.slot)}${describeEffects(clip, fps, false)}`;
}

// Scale, stretch, rotation, opacity and crop are only worth a word when they are not the defaults. Audio draws nothing, so its
// stretch and crop are left out.
function describeTransformChanges(t: Transform, type: Clip["type"]): string {
  let out = "";
  if (t.scale !== 1) out += ` scale=${t.scale}`;
  if (stretchOf(t) !== NO_STRETCH && type !== "audio") out += ` stretch=${stretchOf(t)}`;
  if (t.rotation !== 0) out += ` rotation=${t.rotation}`;
  if (t.opacity !== 1) out += ` opacity=${t.opacity}`;
  if (t.flipH && (type === "video" || type === "image")) out += " flipH=true";
  if (t.flipV && (type === "video" || type === "image")) out += " flipV=true";
  if (t.crop && isCropped(t.crop) && type !== "audio") {
    const { left, top, right, bottom } = t.crop;
    out += ` crop=${JSON.stringify({ left, top, right, bottom })}`;
  }
  return out;
}

// The optional style fields a text sets to something other than their default, as style keys an update_clip takes.
function describeTextLook(style: TextStyle): string {
  const parts = TEXT_EXTRA_KEYS.flatMap((key) => {
    const value = style[key];
    return value === undefined || value === TEXT_STYLE_DEFAULTS[key] ? [] : [`${key}=${typeof value === "string" ? `"${value}"` : String(value)}`];
  });
  return parts.length ? `  ${parts.join(" ")}` : "";
}

// What a nest holds and plays, in a few words: how many clips, the part of its own timeline it plays, how loud.
function nestSummary(clip: NestClip, fps: number): string {
  const count = nestClips(clip).length;
  const name = clip.name ? `"${escapeQuoted(clip.name)}" ` : "";
  return `${name}${count} ${count === 1 ? "clip" : "clips"} in=${framesToSeconds(clip.in, fps)}s of ${framesToSeconds(nestLength(clip), fps)}s vol=${clip.volume}`;
}

function describeClipInDetail(clip: Clip, fps: number): string {
  const range = `${framesToSeconds(clip.start, fps)}–${framesToSeconds(clip.start + clip.duration, fps)}s`;
  const frames = `frames ${clip.start}–${clip.start + clip.duration}`;
  const head = `  ${clip.id}  ${clip.type}  ${range}  ${frames}`;
  const t = clip.transform;
  if (clip.type === "placeholder") {
    return `  ${clip.id}  placeholder(${clip.accepts})  ${range}  ${frames}  ${slotSuffix(clip.slot).trimStart()}${describeEffects(clip, fps, true)}`;
  }
  if (clip.type === "text") {
    const s = clip.style;
    return (
      `${head}  "${escapeQuoted(clip.text)}"` +
      `  font="${escapeQuoted(s.fontFamily)}" size=${s.fontSize} weight=${s.fontWeight} color="${escapeQuoted(s.color)}" align=${s.align} x=${t.x} y=${t.y}` +
      describeTextLook(s) +
      describeTransformChanges(t, clip.type) +
      slotSuffix(clip.slot) +
      describeEffects(clip, fps, true)
    );
  }
  if (clip.type === "shape") return `${head}  ${describeShape(clip)}  x=${t.x} y=${t.y}` + describeTransformChanges(t, clip.type) + describeEffects(clip, fps, true);
  if (clip.type === "adjustment") return `${head}  amount=${t.opacity}` + describeEffects(clip, fps, true);
  if (clip.type === "caption") return `${head}  asset="${escapeQuoted(clip.assetId)}"`;
  if (clip.type === "nest") {
    // Its own line, then what it holds, each clip as it is on the nest's own timeline (which starts at 0).
    const inner = clip.tracks.flatMap((track) => track.clips.map((held) => `\n      in ${track.kind} "${track.name}": ${describeClipInDetail(held, fps).trimStart()}`));
    return `${head}  ${nestSummary(clip, fps)}  x=${t.x} y=${t.y}` + describeTransformChanges(t, clip.type) + describeEffects(clip, fps, true) + inner.join("");
  }
  return (
    `${head}  asset="${escapeQuoted(clip.assetId)}" in=${framesToSeconds(clip.in, fps)}s speed=${clip.speed} vol=${clip.volume}${fadeSuffix(clip)}` +
    `  x=${t.x} y=${t.y} fit=${t.fit}` +
    describeTransformChanges(t, clip.type) +
    captionsSuffix(clip) +
    slotSuffix(clip.slot) +
    describeEffects(clip, fps, true)
  );
}

// Only a clip with captions on says so; off is the default.
function captionsSuffix(clip: MediaClip): string {
  return clip.captions ? " captions=on" : "";
}

// The caption track holds no clips of its own: its lines come from the clips that have captions on.
function describeCaptionLines(doc: TimelineDoc, detail: boolean): string[] {
  const cues = docCues(doc);
  if (cues.length === 0) return ["  (empty)"];
  if (!detail) return [`  (${cues.length} caption ${cues.length === 1 ? "line" : "lines"})`];
  return cues.map((cue) => {
    const range = `${framesToSeconds(cue.start, doc.fps)}–${framesToSeconds(cue.end, doc.fps)}s`;
    return `  ${range}  "${escapeQuoted(cue.text)}"  clip=${cue.clipId} asset="${escapeQuoted(cue.assetId)}" words=${cue.words[0].index}-${cue.words[cue.words.length - 1].index}`;
  });
}

function describeTrack(track: Track, doc: TimelineDoc, detail: boolean): string[] {
  const fps = doc.fps;
  const flags = [
    track.hidden && "hidden",
    track.muted && "muted",
    track.locked && "locked",
  ].filter(Boolean);
  const suffix = flags.length > 0 ? ` (${flags.join(", ")})` : "";
  const lines = [`Track ${track.id} [${track.kind}] "${escapeQuoted(track.name)}"${suffix}`];
  if (track.clips.length === 0) {
    lines.push(...(track.kind === "caption" ? describeCaptionLines(doc, detail) : ["  (empty)"]));
  } else {
    const sorted = [...track.clips].sort((a, b) => a.start - b.start);
    for (const clip of sorted) lines.push(detail ? describeClipInDetail(clip, fps) : describeClip(clip, fps));
  }
  return lines;
}

export function describe(doc: TimelineDoc, opts?: { version?: number; detail?: boolean }): string {
  const version = opts?.version === undefined ? "" : ` · version ${opts.version}`;
  const lines = [
    `Format ${doc.format} ${doc.width}x${doc.height} @${doc.fps}fps · duration ${framesToSeconds(docDuration(doc), doc.fps)}s${version}`,
  ];
  // Only a changed size is worth a line; the guide gives each format's default.
  const safe = safeAreaOf(doc);
  if (safe.custom) {
    const pct = (f: number) => `${Number((f * 100).toFixed(1))}%`;
    lines.push(`Safe area ${pct(safe.width)} wide × ${pct(safe.height)} tall, centred, from ${pct(safe.top)} down (set for this project)`);
  }
  if (doc.guides?.length) {
    const where = (g: { id: string; axis: "x" | "y"; at: number }) => `${g.id} ${g.axis === "x" ? "vertical" : "horizontal"} at ${Number((g.at * 100).toFixed(1))}%`;
    lines.push(`Guides: ${doc.guides.map(where).join(", ")}`);
  }
  if (doc.markers?.length) {
    const sorted = [...doc.markers].sort((a, b) => a.at - b.at);
    lines.push(`Markers: ${sorted.map((m) => `${m.id} ${framesToSeconds(m.at, doc.fps)}s${m.name ? ` "${escapeQuoted(m.name)}"` : ""}`).join(", ")}`);
  }
  if (doc.luts?.length) lines.push(`LUTs: ${doc.luts.map((l) => `${l.id} "${escapeQuoted(l.name)}"`).join(", ")}`);
  if (doc.captions?.style || Object.keys(doc.captions?.transcripts ?? {}).length > 0) {
    const c = captionStyleOf(doc);
    lines.push(`Captions: ${c.preset} font="${escapeQuoted(c.fontFamily)}" size=${c.fontSize} weight=${c.fontWeight} color=${c.color} highlight=${c.highlight} y=${c.y}${c.uppercase ? " uppercase" : ""}`);
  }
  for (const track of doc.tracks) lines.push(...describeTrack(track, doc, opts?.detail === true));
  return lines.join("\n");
}
