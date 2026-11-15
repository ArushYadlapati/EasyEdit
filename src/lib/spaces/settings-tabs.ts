// The tabs of a space's settings, each a page of its own under /s/<slug>/settings/<id>. A plain module, so the
// settings pages on the server can read it as well as the tab row in the browser.
export const SETTINGS_TABS: readonly { id: string; label: string }[] = [{ id: "storage", label: "Storage" }];

export const settingsTabPath = (slug: string, id: string) => `/s/${slug}/settings/${id}`;
