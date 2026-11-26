import { LIMITS } from "@/lib/limits";
import { FormatId } from "@/lib/timeline";

// The home page's New project form, kept in this tab while the visitor signs in. The form writes what is typed as it
// changes, so Back to the home page finds it again; Create project marks it asked for and goes to sign in with
// `next=/new`, where the project is made and opened. It lives in the tab's own session storage, never in the address:
// only this site's home page can ask for a project, so a link from anywhere else to /new makes nothing.
export const FIRST_PROJECT_KEY = "easyedit:first-project";

// Where sign-in carries on to.
export const START_PATH = "/new";

// The name the preview shows for an empty Name field, and the one the project gets.
export const UNTITLED = "Untitled project";

export type FirstProjectDraft = {
  name: string;
  format: FormatId;
  // A custom size as typed, in pixels.
  width: string;
  height: string;
  // Create project was pressed: /new makes it.
  asked: boolean;
};

const SIDE = /^\d{0,5}$/;

// What was kept, if it is one: anything else (another shape, a name over the limit, an unknown format) is nothing.
export function parseDraft(raw: string | null): FirstProjectDraft | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { name, format, width, height, asked } = value as Record<string, unknown>;
  if (typeof name !== "string" || name.length > LIMITS.projectNameChars) return null;
  const formatId = FormatId.safeParse(format);
  if (!formatId.success) return null;
  if (typeof width !== "string" || typeof height !== "string" || !SIDE.test(width) || !SIDE.test(height)) return null;
  return { name, format: formatId.data, width, height, asked: asked === true };
}

// Session storage can be blocked, or throw when full: then nothing is kept, and the form works as before.
function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readDraft(): FirstProjectDraft | null {
  try {
    return parseDraft(store()?.getItem(FIRST_PROJECT_KEY) ?? null);
  } catch {
    return null;
  }
}

export function writeDraft(draft: FirstProjectDraft): void {
  try {
    store()?.setItem(FIRST_PROJECT_KEY, JSON.stringify(draft));
  } catch {
    // Nothing kept.
  }
}

export function clearDraft(): void {
  try {
    store()?.removeItem(FIRST_PROJECT_KEY);
  } catch {
    // Nothing to clear.
  }
}

// The fields the dashboard's own create takes: a custom size only with the custom format.
export function draftFormData(draft: FirstProjectDraft): FormData {
  const form = new FormData();
  form.set("name", draft.name.trim() || UNTITLED);
  form.set("format", draft.format);
  if (draft.format === "custom") {
    form.set("width", draft.width);
    form.set("height", draft.height);
  }
  return form;
}
