import { STYLE_LENGTH_SECONDS, STYLE_PROFILE_KEYS, STYLE_SHOT_SECONDS, isSetValue, type StyleProfile, type StyleProfilePatch } from "./types";

// The Style page's form as it is being filled in, turned into what is saved: text trimmed, blank rows dropped, and only
// the fields that changed sent. Pure.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Whether two profile values are the same: equal text, numbers and switches, the same list in the same order, the
// same fields with the same values (a field left out and one set to undefined count as the same).
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (isRecord(a) || isRecord(b)) {
    if (!isRecord(a) || !isRecord(b)) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => sameValue(a[key], b[key]));
  }
  return a === b;
}

// A profile as it would be saved: text trimmed, blank rows of the Always and Never lists dropped, the parts of Captions
// left unset taken off, and every field that says nothing (an empty text or list) left out.
export function tidyProfile(profile: StyleProfile): StyleProfile {
  const tidy: Record<string, unknown> = {};
  for (const key of STYLE_PROFILE_KEYS) {
    let value: unknown = profile[key];
    if (typeof value === "string") value = value.trim();
    else if (key === "always" || key === "never") value = (value as string[] | undefined)?.map((item) => item.trim()).filter(Boolean);
    else if (key === "captions" && isRecord(value)) value = Object.fromEntries(Object.entries(value).filter(([, part]) => part !== undefined));
    if (isSetValue(value)) tidy[key] = value;
  }
  return tidy as StyleProfile;
}

// The change that turns the saved profile into the one in the form: each field that differs once both are tidied,
// with null for a field the form leaves empty. Fields that are the same are left out, so {} means nothing changed.
export function profilePatch(saved: StyleProfile, draft: StyleProfile): StyleProfilePatch {
  const before = tidyProfile(saved);
  const after = tidyProfile(draft);
  const patch: Record<string, unknown> = {};
  for (const key of STYLE_PROFILE_KEYS) {
    if (!sameValue(before[key], after[key])) patch[key] = after[key] ?? null;
  }
  return patch as StyleProfilePatch;
}

// What a typed field holds: nothing (empty), or a number, or something that isn't a number (null).
function typedNumber(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// What the two Typical length boxes hold: ok with no length when both are empty, ok with a length when both are
// numbers of seconds in range with the shorter first, and not ok otherwise.
export function typedLength(min: string, max: string): { ok: true; value?: { min: number; max: number } } | { ok: false } {
  const low = typedNumber(min);
  const high = typedNumber(max);
  if (low === undefined && high === undefined) return { ok: true };
  const fits = (n: number | null | undefined): n is number =>
    typeof n === "number" && n >= STYLE_LENGTH_SECONDS.min && n <= STYLE_LENGTH_SECONDS.max;
  if (!fits(low) || !fits(high) || low > high) return { ok: false };
  return { ok: true, value: { min: low, max: high } };
}

// What the Typical shot box holds: ok with no shot when it is empty, ok with a number of seconds in range, rounded
// to a tenth, and not ok otherwise.
export function typedShot(text: string): { ok: true; value?: number } | { ok: false } {
  const n = typedNumber(text);
  if (n === undefined) return { ok: true };
  if (n === null || n < STYLE_SHOT_SECONDS.min || n > STYLE_SHOT_SECONDS.max) return { ok: false };
  return { ok: true, value: Math.round(n * 10) / 10 };
}

// A number as the form's box shows it, or an empty box for none.
export function numberText(n: number | undefined): string {
  return n === undefined ? "" : String(Number(n.toFixed(2)));
}
