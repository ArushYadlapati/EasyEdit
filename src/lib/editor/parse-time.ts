const WHOLE = /^\d+$/;
const DECIMAL = /^(\d+(\.\d+)?|\.\d+)$/;

// A typed time as a frame, or null when it is not a time. The parts, split on ":" (or ";"), read like the readout:
//   "12" or "1.5"   seconds
//   "1:30"          minutes and seconds (the seconds may have a decimal)
//   "0:03:15"       minutes, seconds, frames (what formatTimecode writes)
//   "1:00:03:15"    hours, minutes, seconds, frames
// Parts past their range carry over ("0:90" is a minute and a half), as in other editors. Never negative.
export function parseTime(text: string, fps: number): number | null {
  const parts = text.split(/[:;]/).map((p) => p.trim());
  if (parts.length > 4 || parts.some((p) => p === "")) return null;

  const withFrames = parts.length >= 3;
  const frames = withFrames ? parts.pop()! : "0";
  const seconds = parts.pop()!;
  const minutes = parts.pop() ?? "0";
  const hours = parts.pop() ?? "0";

  if (![frames, minutes, hours].every((p) => WHOLE.test(p))) return null;
  if (!(withFrames ? WHOLE : DECIMAL).test(seconds)) return null;

  const totalSeconds = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Math.round(totalSeconds * fps) + Number(frames);
}
