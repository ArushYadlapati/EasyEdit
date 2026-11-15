// Which of the dashboard sidebar's sections are collapsed, kept in this browser. One list for every space: a section
// hidden in one is hidden in all.

export const SECTION_IDS = ["spaces", "projects", "pinned", "folders", "space"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTIONS_KEY = "easyedit.sidebar-collapsed";

const isSection = (value: unknown): value is SectionId => (SECTION_IDS as readonly unknown[]).includes(value);

// The saved sections; nothing saved, a value that is not a list of sections, or blocked storage means all are open.
export function readCollapsed(storage: Pick<Storage, "getItem">): ReadonlySet<SectionId> {
  try {
    const saved: unknown = JSON.parse(storage.getItem(SECTIONS_KEY) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter(isSection) : []);
  } catch {
    return new Set();
  }
}

export function withToggled(collapsed: ReadonlySet<SectionId>, id: SectionId): SectionId[] {
  return collapsed.has(id) ? [...collapsed].filter((other) => other !== id) : [...collapsed, id];
}

// A refused write (blocked or full storage) only means the choice is not remembered.
export function writeCollapsed(storage: Pick<Storage, "setItem">, ids: readonly SectionId[]): void {
  try {
    storage.setItem(SECTIONS_KEY, JSON.stringify(ids));
  } catch {
    // nothing to do
  }
}
