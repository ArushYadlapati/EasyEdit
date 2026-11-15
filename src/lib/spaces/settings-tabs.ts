import type { MySpace } from "./types";

export type SettingsTab = { id: string; label: string };

// The tabs of a space's settings, each a page of its own under /s/<slug>/settings/<id>. A plain module, so the
// settings pages on the server can read it as well as the tab row in the browser.
export const SETTINGS_TABS: readonly SettingsTab[] = [
  { id: "members", label: "Members" },
  { id: "storage", label: "Storage" },
];

export const settingsTabPath = (slug: string, id: string) => `/s/${slug}/settings/${id}`;

// The tabs this member of the space may open: Members in a team, for everyone in it; Storage for its admins (the owner
// of a personal space is its admin). Each page checks again for itself.
export function settingsTabsFor(space: Pick<MySpace, "kind" | "role">): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => (tab.id === "members" ? space.kind === "team" : space.role === "admin"));
}
