// A timeline as other editors hand it over, in one neutral shape that every format here is read into and written
// from: Final Cut Pro 7 XML (which Premiere Pro and DaVinci Resolve both export and import), an EDL, and
// OpenTimelineIO. Times are seconds, so a file at one frame rate fits a project at another. It carries the cut, not
// the look: where each clip sits, what part of its file it shows, its speed, level and opacity, cross dissolves and
// markers. Effects, grades, titles and nested timelines do not come across.

export type SeqClip = {
  name: string;
  // The media file's name as the other program knew it, which is all there is to find it again by.
  fileName: string | null;
  // Which kind of track it sat on, and which one: 0 is the lowest video track, or the first audio track.
  kind: "video" | "audio";
  track: number;
  start: number;
  duration: number;
  in: number; // where in its file it starts
  speed: number; // 1 as recorded; below 0 backward
  volume?: number; // 1 as recorded
  opacity?: number;
  dissolveIn?: number; // a cross dissolve from the clip before it, this long
  // A video clip's own sound plays with it. Formats that list sound apart from picture get it written as its own
  // clips; reading them back, the pair becomes one clip again (see plan.ts).
  sound?: boolean;
};

export type SeqMarker = { at: number; name: string };

export type Sequence = {
  name: string;
  fps: number | null;
  width: number | null;
  height: number | null;
  clips: SeqClip[];
  markers: SeqMarker[];
  notes: string[]; // what was left out or guessed, for the person to read
};

export type InterchangeFormat = "fcp7" | "edl" | "otio";

export const FORMATS: { id: InterchangeFormat; label: string; extension: string; mime: string; hint: string }[] = [
  { id: "fcp7", label: "Final Cut Pro 7 XML", extension: "xml", mime: "application/xml", hint: "Premiere Pro and DaVinci Resolve both open and export this. Keeps tracks, speed, levels and dissolves." },
  { id: "otio", label: "OpenTimelineIO", extension: "otio", mime: "application/json", hint: "DaVinci Resolve and newer tools. Keeps tracks, speed and dissolves." },
  { id: "edl", label: "EDL (CMX 3600)", extension: "edl", mime: "text/plain", hint: "The oldest and simplest: one video track and its cuts. Opens almost anywhere." },
];

// Which format a file is, by its name and, failing that, by how it starts. Null when it is none of them.
export function formatOf(fileName: string, text: string): InterchangeFormat | null {
  const ending = fileName.toLowerCase().split(".").pop() ?? "";
  const head = text.slice(0, 2000).replace(/^﻿/, "").trimStart();
  if (ending === "otio" || /^\{[\s\S]*"OTIO_SCHEMA"/.test(head)) return "otio";
  if (head.startsWith("<")) return /<xmeml[\s>]/.test(text.slice(0, 4000)) ? "fcp7" : null;
  if (ending === "edl" || /^\s*TITLE:/im.test(head) || /^\d{3,6}\s+\S+\s+\S+\s+\S+/m.test(head)) return "edl";
  return null;
}

// The last part of a path or file URL, as a plain name.
export function baseName(path: string): string {
  const last = path.replace(/[?#].*$/, "").split(/[\\/]/).filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// hh:mm:ss:ff at a frame rate. Drop-frame counting is not used: every frame is counted.
export function timecode(frames: number, fps: number): string {
  const f = Math.max(0, Math.round(frames));
  const two = (n: number) => String(n).padStart(2, "0");
  const seconds = Math.floor(f / fps);
  return `${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}:${two(f % fps)}`;
}

// The frames a timecode names, or null when it is not one. A semicolon (drop-frame) is read like a colon.
export function framesOf(code: string, fps: number): number | null {
  const m = /^(\d{1,2})[:;](\d{2})[:;](\d{2})[:;](\d{2})$/.exec(code.trim());
  if (!m) return null;
  const [h, min, s, f] = m.slice(1).map(Number);
  return ((h * 60 + min) * 60 + s) * fps + f;
}
