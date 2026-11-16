// Which of the dashboard sidebar's sections are collapsed, kept in this browser as a cookie so the server draws them
// folded on the first paint (as the editor keeps its panel sizes). One list for every space: a section hidden in one is
// hidden in all.

export const SECTION_IDS = ["spaces", "projects", "pinned", "folders", "space", "invitations"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

// Under /s, so API requests do not carry it. Its value is the ids joined by dots, which a cookie carries as they are.
export const SECTIONS_COOKIE = "easyedit_sidebar";

const isSection = (value: string): value is SectionId => (SECTION_IDS as readonly string[]).includes(value);

// The cookie's sections; nothing saved, or text that names no section, means all are open.
export function parseCollapsed(value: string | null | undefined): ReadonlySet<SectionId> {
  return new Set((value ?? "").split(".").filter(isSection));
}

export function formatCollapsed(ids: readonly SectionId[]): string {
  return ids.join(".");
}

export function withToggled(collapsed: ReadonlySet<SectionId>, id: SectionId): SectionId[] {
  return collapsed.has(id) ? [...collapsed].filter((other) => other !== id) : [...collapsed, id];
}
