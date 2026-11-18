import { graphemes } from "@/lib/text";
import { NO_STRETCH, docDuration, isCropped, safeAreaOf, stretchOf } from "./presets";
import { KEYFRAME_PROPS } from "./keyframes";
import { shapeToolOf } from "./shapes";
import type { Clip, KeyframeProp, ShapeClip, Slot, Track, TimelineDoc, Transform, Transition } from "./types";

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

// One property's keyframes, at:value~ease each, so a list can be patched back whole with only one keyframe changed.
// Linear, the default, is left out.
function keyframeList(clip: Clip, prop: KeyframeProp): string {
  const keys = clip.keyframes?.[prop] ?? [];
  return keys.map((k) => `${k.at}:${Number(k.value.toFixed(4))}${k.ease && k.ease !== "linear" ? `~${k.ease}` : ""}`).join(",");
}

function describeEffects(clip: Clip, fps: number, detail: boolean): string {
  let out = "";
  if (clip.type === "text") {
    if (clip.animationIn) out += ` anim-in=${clip.animationIn.preset} ${framesToSeconds(clip.animationIn.frames, fps)}s`;
    if (clip.animationOut) out += ` anim-out=${clip.animationOut.preset} ${framesToSeconds(clip.animationOut.frames, fps)}s`;
    if (clip.emphasis) out += ` emphasis=${clip.emphasis.preset}${clip.emphasis.preset === "highlight_word" ? ` ${clip.emphasis.color ?? "#FFD400"}` : ""}`;
  } else {
    if (clip.transitionIn) out += ` in=${transitionToken(clip.transitionIn)} ${framesToSeconds(clip.transitionIn.frames, fps)}s`;
    if (clip.transitionOut) out += ` out=${transitionToken(clip.transitionOut)} ${framesToSeconds(clip.transitionOut.frames, fps)}s`;
  }
  const keyed = KEYFRAME_PROPS.filter((p) => (clip.keyframes?.[p]?.length ?? 0) > 0);
  if (detail) for (const p of keyed) out += ` kf.${p}=${keyframeList(clip, p)}`;
  else if (keyed.length > 0) out += ` kf=${keyed.join(",")}`;
  return out;
}

// Every shape field that is set, as JSON-ish key=value pairs an update_clip patch can copy.
function describeShape(clip: ShapeClip): string {
  const keys = ["shape", "width", "height", "stroke", "strokeWidth", "dash", "fill", "radius", "heads", "head", "headSize", "bend"] as const;
  return keys
    .filter((k) => clip[k] !== undefined && !(clip.shape === "arrow" && k === "height"))
    .map((k) => `${k}=${typeof clip[k] === "string" ? `"${clip[k]}"` : clip[k]}`)
    .join(" ");
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
  return `  ${clip.id}  ${clip.type}  ${range}  asset=${clip.assetId} in=${framesToSeconds(clip.in, fps)}s speed=${clip.speed} vol=${clip.volume}${slotSuffix(clip.slot)}${describeEffects(clip, fps, false)}`;
}

// Scale, stretch, rotation, opacity and crop are only worth a word when they are not the defaults. Audio draws nothing, so its
// stretch and crop are left out.
function describeTransformChanges(t: Transform, type: Clip["type"]): string {
  let out = "";
  if (t.scale !== 1) out += ` scale=${t.scale}`;
  if (stretchOf(t) !== NO_STRETCH && type !== "audio") out += ` stretch=${stretchOf(t)}`;
  if (t.rotation !== 0) out += ` rotation=${t.rotation}`;
  if (t.opacity !== 1) out += ` opacity=${t.opacity}`;
  if (t.crop && isCropped(t.crop) && type !== "audio") {
    const { left, top, right, bottom } = t.crop;
    out += ` crop=${JSON.stringify({ left, top, right, bottom })}`;
  }
  return out;
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
      describeTransformChanges(t, clip.type) +
      slotSuffix(clip.slot) +
      describeEffects(clip, fps, true)
    );
  }
  if (clip.type === "shape") return `${head}  ${describeShape(clip)}  x=${t.x} y=${t.y}` + describeTransformChanges(t, clip.type) + describeEffects(clip, fps, true);
  return (
    `${head}  asset="${escapeQuoted(clip.assetId)}" in=${framesToSeconds(clip.in, fps)}s speed=${clip.speed} vol=${clip.volume}` +
    `  x=${t.x} y=${t.y} fit=${t.fit}` +
    describeTransformChanges(t, clip.type) +
    slotSuffix(clip.slot) +
    describeEffects(clip, fps, true)
  );
}

function describeTrack(track: Track, fps: number, detail: boolean): string[] {
  const flags = [
    track.hidden && "hidden",
    track.muted && "muted",
    track.locked && "locked",
  ].filter(Boolean);
  const suffix = flags.length > 0 ? ` (${flags.join(", ")})` : "";
  const lines = [`Track ${track.id} [${track.kind}] "${escapeQuoted(track.name)}"${suffix}`];
  if (track.clips.length === 0) {
    lines.push("  (empty)");
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
  for (const track of doc.tracks) lines.push(...describeTrack(track, doc.fps, opts?.detail === true));
  return lines.join("\n");
}
