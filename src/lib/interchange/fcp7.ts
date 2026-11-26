import { baseName, type SeqClip, type Sequence } from "./model";
import { child, children, escapeXml, numberOf, parseXml, textOf, type XmlNode } from "./xml";

// Final Cut Pro 7 XML ("xmeml"): the timeline format Premiere Pro and DaVinci Resolve both export and import. A
// sequence holds video and audio tracks; a track holds clip items and, between two of them, transition items. Every
// time in the file is a count of frames at the sequence's timebase.

export type Fcp7Result = { ok: true; sequence: Sequence } | { ok: false; message: string };

// The first sequence in the file, wherever it sits (a bare sequence, or inside a project and its bins).
function findSequence(node: XmlNode): XmlNode | null {
  if (node.name === "sequence" && child(node, "media")) return node;
  for (const c of node.children) {
    const found = findSequence(c);
    if (found) return found;
  }
  return null;
}

// A clip item's effect by name, and one of its parameters' value as written.
function effectOf(item: XmlNode, name: RegExp): XmlNode | undefined {
  return children(item, "filter").map((f) => child(f, "effect")).find((e) => e && name.test(textOf(e, "name")));
}
function parameterText(effect: XmlNode | undefined, id: RegExp): string | null {
  const found = children(effect, "parameter").find((p) => id.test(textOf(p, "parameterid")) || id.test(textOf(p, "name")));
  return found ? textOf(found, "value") : null;
}
function parameterNumber(effect: XmlNode | undefined, id: RegExp): number | null {
  const raw = parameterText(effect, id);
  const n = raw === null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}
const isTrue = (raw: string | null) => raw !== null && (raw.toUpperCase() === "TRUE" || raw === "1");

type Span = { start: number; end: number };

export function readFcp7(text: string): Fcp7Result {
  const root = parseXml(text);
  if (!root) return { ok: false, message: "That file is not XML this can read." };
  const sequence = root.name === "xmeml" || root.name === "sequence" ? findSequence(root) : null;
  if (!sequence) return { ok: false, message: "That XML file has no timeline in it. Export a Final Cut Pro 7 XML of one sequence." };
  const timebase = numberOf(child(sequence, "rate"), "timebase");
  if (!timebase || timebase <= 0) return { ok: false, message: "That timeline does not say its frame rate." };
  const seconds = (frames: number) => frames / timebase;
  const media = child(sequence, "media");
  const format = child(child(child(media, "video"), "format"), "samplecharacteristics");
  const notes: string[] = [];
  const clips: SeqClip[] = [];
  // A file is spelled out once and named by its id after that.
  const files = new Map<string, string>();
  let moved = 0;
  let nested = 0;
  let ramps = 0;

  const readTrack = (track: XmlNode, kind: "video" | "audio", index: number) => {
    const items = track.children.filter((c) => c.name === "clipitem" || c.name === "transitionitem");
    // Each transition's span and the cut it sits on.
    const cutOf = (t: XmlNode): Span & { cut: number } => {
      const start = numberOf(t, "start") ?? 0;
      const end = numberOf(t, "end") ?? start;
      const alignment = textOf(t, "alignment");
      const cut = alignment.startsWith("start") ? start : alignment.startsWith("end") ? end : Math.round((start + end) / 2);
      return { start, end, cut };
    };
    items.forEach((item, at) => {
      if (item.name !== "clipitem") return;
      if (textOf(item, "enabled").toUpperCase() === "FALSE") return;
      if (child(item, "sequence")) {
        nested++;
        return;
      }
      const before = at > 0 && items[at - 1].name === "transitionitem" ? cutOf(items[at - 1]) : null;
      const after = at + 1 < items.length && items[at + 1].name === "transitionitem" ? cutOf(items[at + 1]) : null;
      let start = numberOf(item, "start") ?? -1;
      let end = numberOf(item, "end") ?? -1;
      let sourceIn = numberOf(item, "in") ?? 0;
      // A clip under a transition has no start or end of its own (−1): the cut is where it starts or ends. Its `in`
      // is the frame shown where the transition begins, so a later cut moves it on by the difference.
      if (start < 0 && before) {
        start = before.cut;
        sourceIn += before.cut - before.start;
      }
      if (end < 0 && after) end = after.cut;
      if (start < 0 || end <= start) return;

      const file = child(item, "file");
      let fileName: string | null = null;
      if (file) {
        const id = file.attrs.id ?? "";
        const path = textOf(file, "pathurl");
        const named = path ? baseName(path) : textOf(file, "name");
        if (named) {
          fileName = named;
          if (id) files.set(id, named);
        } else fileName = files.get(id) ?? null;
      }
      const remap = effectOf(item, /time\s*remap/i);
      const speedPercent = parameterNumber(remap, /^speed$/i);
      let speed = speedPercent !== null && speedPercent !== 0 ? Math.abs(speedPercent) / 100 : 1;
      if (isTrue(parameterText(remap, /^reverse$/i)) || (speedPercent !== null && speedPercent < 0)) speed = -speed;
      if (isTrue(parameterText(remap, /^variablespeed$/i))) ramps++;
      const opacity = kind === "video" ? parameterNumber(effectOf(item, /^opacity$/i), /^opacity$/i) : null;
      const level = kind === "audio" ? parameterNumber(effectOf(item, /audio\s*levels/i), /^level$/i) : null;
      if (kind === "video" && (effectOf(item, /basic\s*motion/i) || effectOf(item, /^crop$/i) || effectOf(item, /distort/i))) moved++;

      const clip: SeqClip = {
        name: textOf(item, "name") || fileName || "Clip",
        fileName,
        kind,
        track: index,
        start: seconds(start),
        duration: seconds(end - start),
        in: seconds(Math.max(0, sourceIn)),
        speed,
      };
      if (opacity !== null && opacity < 100) clip.opacity = Math.max(0, opacity) / 100;
      if (level !== null && level !== 1) clip.volume = Math.max(0, level);
      // A dissolve only when a clip really ends at this cut: a fade from black is no cross dissolve.
      if (before && kind === "video" && at >= 2 && items[at - 2].name === "clipitem") clip.dissolveIn = seconds(before.end - before.start);
      clips.push(clip);
    });
  };

  children(child(media, "video"), "track").forEach((track, i) => readTrack(track, "video", i));
  children(child(media, "audio"), "track").forEach((track, i) => readTrack(track, "audio", i));
  if (clips.length === 0) return { ok: false, message: "That timeline has no clips in it." };

  const markers = children(sequence, "marker").flatMap((m) => {
    const at = numberOf(m, "in");
    return at === null || at < 0 ? [] : [{ at: seconds(at), name: textOf(m, "name") || textOf(m, "comment") }];
  });
  if (nested > 0) notes.push(`${nested} nested ${nested === 1 ? "timeline was" : "timelines were"} left out: flatten them before exporting.`);
  if (moved > 0) notes.push(`${moved} ${moved === 1 ? "clip has" : "clips have"} a position, size or crop of their own, which did not come across.`);
  if (ramps > 0) notes.push(`${ramps} ${ramps === 1 ? "clip changes" : "clips change"} speed as it plays; it was given one speed.`);
  if (textOf(child(sequence, "rate"), "ntsc").toUpperCase() === "TRUE") notes.push(`The timeline runs at ${(timebase * 1000 / 1001).toFixed(2)} frames a second; it was read as ${timebase}.`);
  return {
    ok: true,
    sequence: { name: textOf(sequence, "name") || "Timeline", fps: timebase, width: numberOf(format, "width"), height: numberOf(format, "height"), clips, markers, notes },
  };
}

// A sequence as Final Cut Pro 7 XML. fileSeconds: each file's own length, when known, so the other program can show
// what is left to trim. Each video clip's sound, and each audio clip, is written as a stereo pair on two audio
// tracks, which is how these programs expect a stereo file.
export function writeFcp7(sequence: Sequence, fps: number, size: { width: number; height: number }, fileSeconds: (fileName: string) => number | null = () => null): string {
  const frames = (seconds: number) => Math.round(seconds * fps);
  const rate = `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  const fileIds = new Map<string, string>();
  const spelled = new Set<string>();
  let nextClip = 0;

  const fileXml = (clip: SeqClip): string => {
    const name = clip.fileName ?? clip.name;
    if (!fileIds.has(name)) fileIds.set(name, `file-${fileIds.size + 1}`);
    const id = fileIds.get(name)!;
    if (spelled.has(id)) return `<file id="${id}"/>`;
    spelled.add(id);
    const length = fileSeconds(name);
    return (
      `<file id="${id}"><name>${escapeXml(name)}</name><pathurl>file://localhost/${encodeURIComponent(name)}</pathurl>${rate}` +
      (length !== null ? `<duration>${frames(length)}</duration>` : "") +
      `<media><video><samplecharacteristics>${rate}<width>${size.width}</width><height>${size.height}</height></samplecharacteristics></video>` +
      `<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio></media></file>`
    );
  };
  const parameter = (id: string, name: string, value: string | number) => `<parameter authoringApp="PremierePro"><parameterid>${id}</parameterid><name>${name}</name><value>${value}</value></parameter>`;
  const itemXml = (clip: SeqClip, channel: number | null): string => {
    const start = frames(clip.start);
    const end = frames(clip.start + clip.duration);
    const sourceIn = frames(clip.in);
    const sourceOut = sourceIn + Math.max(1, Math.round((end - start) * Math.abs(clip.speed || 1)));
    const length = fileSeconds(clip.fileName ?? clip.name);
    let filters = "";
    if (clip.speed !== 1 && clip.speed !== 0) {
      filters += `<filter><effect><name>Time Remap</name><effectid>timeremap</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>${parameter("speed", "speed", Number((Math.abs(clip.speed) * 100).toFixed(3)))}${parameter("reverse", "reverse", clip.speed < 0 ? "TRUE" : "FALSE")}</effect></filter>`;
    }
    if (channel === null && clip.opacity !== undefined && clip.opacity < 1) {
      filters += `<filter><effect><name>Opacity</name><effectid>opacity</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>${parameter("opacity", "opacity", Number((clip.opacity * 100).toFixed(2)))}</effect></filter>`;
    }
    if (channel !== null && clip.volume !== undefined && clip.volume !== 1) {
      filters += `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype>${parameter("level", "Level", Number(clip.volume.toFixed(4)))}</effect></filter>`;
    }
    return (
      `<clipitem id="clipitem-${++nextClip}"><name>${escapeXml(clip.name)}</name><enabled>TRUE</enabled><duration>${length !== null ? frames(length) : sourceOut}</duration>${rate}` +
      `<start>${start}</start><end>${end}</end><in>${sourceIn}</in><out>${sourceOut}</out>${fileXml(clip)}` +
      (channel !== null ? `<sourcetrack><mediatype>audio</mediatype><trackindex>${channel}</trackindex></sourcetrack>` : "") +
      `${filters}</clipitem>`
    );
  };
  const trackXml = (clips: SeqClip[], channel: number | null): string => {
    let out = "<track>";
    for (const clip of [...clips].sort((a, b) => a.start - b.start)) {
      if (channel === null && clip.dissolveIn && clip.dissolveIn > 0) {
        const start = frames(clip.start);
        out += `<transitionitem><start>${start}</start><end>${start + frames(clip.dissolveIn)}</end><alignment>start</alignment>${rate}<effect><name>Cross Dissolve</name><effectid>Cross Dissolve</effectid><effectcategory>Dissolve</effectcategory><effecttype>transition</effecttype><mediatype>video</mediatype></effect></transitionitem>`;
      }
      out += itemXml(clip, channel);
    }
    return `${out}<enabled>TRUE</enabled><locked>FALSE</locked></track>`;
  };

  const byTrack = (kind: "video" | "audio") => {
    const tracks: SeqClip[][] = [];
    for (const clip of sequence.clips) if (clip.kind === kind) (tracks[clip.track] ??= []).push(clip);
    return Array.from(tracks, (t) => t ?? []);
  };
  const video = byTrack("video");
  // Sound lanes: each video track's clips that sound, then each audio track. A lane is two tracks, left and right.
  const lanes = [...video.map((clips) => clips.filter((c) => c.sound)).filter((clips) => clips.length > 0), ...byTrack("audio")];
  const end = Math.max(0, ...sequence.clips.map((c) => frames(c.start + c.duration)));
  const markers = sequence.markers.map((m) => `<marker><name>${escapeXml(m.name)}</name><comment></comment><in>${frames(m.at)}</in><out>-1</out></marker>`).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="sequence-1"><name>${escapeXml(sequence.name)}</name><duration>${end}</duration>${rate}` +
    `<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>` +
    `<media><video><format><samplecharacteristics>${rate}<width>${size.width}</width><height>${size.height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>` +
    `${(video.length > 0 ? video : [[]]).map((clips) => trackXml(clips, null)).join("")}</video>` +
    `<audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>` +
    `${lanes.map((clips) => trackXml(clips, 1) + trackXml(clips, 2)).join("")}</audio></media>${markers}</sequence></xmeml>\n`
  );
}
