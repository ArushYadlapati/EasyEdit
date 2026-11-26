import { framesOf, timecode, type SeqClip, type Sequence } from "./model";

// An EDL (CMX 3600): a plain list of cuts, one event a line, with timecodes for where each clip comes from in its
// source and where it lands on the timeline. It knows one video track and a few audio tracks, has no frame rate of
// its own (it is read at the project's) and names clips in comment lines.

export type EdlResult = { ok: true; sequence: Sequence } | { ok: false; message: string };

const TC = String.raw`(\d{1,2}[:;]\d{2}[:;]\d{2}[:;]\d{2})`;
const EVENT = new RegExp(String.raw`^(\d+)\s+(\S+)\s+(\S+)\s+([A-Za-z]\w*)(?:\s+(\d+))?\s+${TC}\s+${TC}\s+${TC}\s+${TC}`);

// Which tracks an event's track field names: video, and audio tracks by number.
function tracksOf(field: string): { video: boolean; audio: number[] } {
  const f = field.toUpperCase();
  if (f === "B" || f === "AA/V") return { video: true, audio: [] }; // picture with its own sound: one clip
  if (f === "V") return { video: true, audio: [] };
  if (f === "AA") return { video: false, audio: [0] }; // a stereo pair is one clip here
  const n = /^A(\d*)$/.exec(f);
  if (n) return { video: false, audio: [n[1] === "" ? 0 : Math.max(0, Number(n[1]) - 1)] };
  if (/^A\d*\/V$/.test(f)) return { video: true, audio: [] };
  return { video: false, audio: [] };
}

export function readEdl(text: string, fps: number): EdlResult {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  let name = "Timeline";
  const clips: SeqClip[] = [];
  const notes: string[] = [];
  let lastOfEvent = null as { number: string; clips: SeqClip[] } | null;
  let speedChanges = 0;
  let wipes = 0;
  for (const raw of lines) {
    const line = raw.trim();
    const title = /^TITLE:\s*(.*)$/i.exec(line);
    if (title) {
      name = title[1].trim() || name;
      continue;
    }
    if (/^M2\s/i.test(line)) {
      speedChanges++;
      continue;
    }
    const named = /^\*\s*(FROM|TO)\s+CLIP\s+NAME:\s*(.*)$/i.exec(line);
    if (named && lastOfEvent) {
      // FROM names the event's cut (or the clip a dissolve leaves); TO names the clip a dissolve arrives at. The
      // clips kept for the event are the ones that last on the timeline, so the last name given wins for a dissolve.
      for (const clip of lastOfEvent.clips) {
        if (named[1].toUpperCase() === "FROM" && clip.dissolveIn !== undefined) continue;
        clip.name = named[2].trim();
        clip.fileName = named[2].trim();
      }
      continue;
    }
    const m = EVENT.exec(line);
    if (!m) continue;
    const [, number, reel, trackField, transition, length, srcIn, srcOut, recIn, recOut] = m;
    const times = [srcIn, srcOut, recIn, recOut].map((t) => framesOf(t, fps));
    if (times.some((t) => t === null)) continue;
    const [sourceIn, , recordIn, recordOut] = times as number[];
    if (lastOfEvent?.number !== number) lastOfEvent = { number, clips: [] };
    if (recordOut <= recordIn) continue; // the clip a dissolve leaves: it is already on the list from its own event
    if (/^(BL|BLACK)$/i.test(reel)) continue;
    const { video, audio } = tracksOf(trackField);
    const kind = transition.toUpperCase();
    if (kind.startsWith("W")) wipes++;
    const make = (trackKind: "video" | "audio", track: number): SeqClip => ({
      name: reel,
      fileName: reel === "AX" ? null : reel,
      kind: trackKind,
      track,
      start: recordIn / fps,
      duration: (recordOut - recordIn) / fps,
      in: sourceIn / fps,
      speed: 1,
      ...(trackKind === "video" && /^(B|AA\/V|A\d*\/V)$/i.test(trackField) && { sound: true }),
      ...(trackKind === "video" && (kind === "D" || kind.startsWith("W")) && length && Number(length) > 0 && { dissolveIn: Number(length) / fps }),
    });
    const made = [...(video ? [make("video", 0)] : []), ...audio.map((track) => make("audio", track))];
    clips.push(...made);
    lastOfEvent.clips.push(...made);
  }
  if (clips.length === 0) return { ok: false, message: "That EDL has no events in it." };
  // Timelines usually start at one hour; whole hours before the first clip are taken off.
  const first = Math.min(...clips.map((c) => c.start));
  const offset = Math.floor(first / 3600) * 3600;
  for (const clip of clips) clip.start -= offset;
  // A video clip with no sound of its own in the list is silent.
  for (const clip of clips) if (clip.kind === "video" && !clip.sound) clip.sound = false;
  if (speedChanges > 0) notes.push(`${speedChanges} speed ${speedChanges === 1 ? "change was" : "changes were"} left out: an EDL's speed lines are not read.`);
  if (wipes > 0) notes.push(`${wipes} ${wipes === 1 ? "wipe was" : "wipes were"} read as a cross dissolve.`);
  notes.push(`An EDL has no frame rate of its own: it was read at this project's, ${fps} frames a second.`);
  return { ok: true, sequence: { name, fps, width: null, height: null, clips, markers: [], notes } };
}

// A sequence as an EDL at a frame rate. Only the lowest video track and the first four audio tracks fit; the rest
// are named in the notes. The timeline starts at one hour, as these lists do by habit.
export function writeEdl(sequence: Sequence, fps: number): { text: string; notes: string[] } {
  const notes: string[] = [];
  const frames = (seconds: number) => Math.round(seconds * fps);
  const start = 3600 * fps;
  const kept = sequence.clips.filter((c) => (c.kind === "video" ? c.track === 0 : c.track < 4)).sort((a, b) => a.start - b.start || (a.kind === "video" ? -1 : 1));
  const dropped = sequence.clips.length - kept.length;
  if (dropped > 0) notes.push(`${dropped} ${dropped === 1 ? "clip is" : "clips are"} on tracks an EDL has no room for (it holds one video track and four audio tracks).`);
  if (kept.some((c) => c.speed !== 1)) notes.push("Clips that play faster, slower or backward are listed at normal speed.");
  let text = `TITLE: ${sequence.name.replace(/[\r\n]+/g, " ")}\nFCM: NON-DROP FRAME\n\n`;
  kept.forEach((clip, i) => {
    const track = clip.kind === "video" ? (clip.sound ? "AA/V" : "V") : clip.track === 0 ? "AA" : `A${clip.track + 1}`;
    const length = frames(clip.duration);
    const sourceIn = frames(clip.in);
    const recordIn = start + frames(clip.start);
    const number = String(i + 1).padStart(3, "0");
    const dissolve = clip.kind === "video" && clip.dissolveIn && clip.dissolveIn > 0 ? Math.min(length, frames(clip.dissolveIn)) : 0;
    const row = (transition: string, a: number, b: number, c: number, d: number) =>
      `${number}  ${"AX".padEnd(8)} ${track.padEnd(5)} ${transition.padEnd(8)} ${timecode(a, fps)} ${timecode(b, fps)} ${timecode(c, fps)} ${timecode(d, fps)}\n`;
    if (dissolve > 0) {
      // A dissolve is two lines: the clip it leaves, with no length, then the clip it arrives at.
      const from = kept.slice(0, i).reverse().find((c) => c.kind === "video");
      const fromOut = from ? frames(from.in + from.duration * Math.abs(from.speed || 1)) : 0;
      text += row("C", fromOut, fromOut, recordIn, recordIn);
      text += row(`D    ${String(dissolve).padStart(3, "0")}`, sourceIn, sourceIn + length, recordIn, recordIn + length);
      if (from) text += `* FROM CLIP NAME: ${from.fileName ?? from.name}\n`;
      text += `* TO CLIP NAME: ${clip.fileName ?? clip.name}\n\n`;
    } else {
      text += row("C", sourceIn, sourceIn + length, recordIn, recordIn + length);
      text += `* FROM CLIP NAME: ${clip.fileName ?? clip.name}\n\n`;
    }
  });
  return { text, notes };
}
