import { PERSONAL_ALIAS, type Space } from "./types";

// The address of a space's dashboard, with an optional query such as the open folder.
export function spacePath(slug: string, query?: Record<string, string>): string {
  const base = `/s/${slug}`;
  const qs = query ? new URLSearchParams(query).toString() : "";
  return qs ? `${base}?${qs}` : base;
}

export function editorPath(slug: string, projectId: string): string {
  return `/s/${slug}/editor/${projectId}`;
}

// What addresses use for a space: a personal space is always "personal", never its id.
export function slugFor(space: Space): string {
  return space.kind === "personal" ? PERSONAL_ALIAS : space.slug;
}
