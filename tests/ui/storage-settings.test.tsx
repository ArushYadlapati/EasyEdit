// @vitest-environment happy-dom
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsIndex from "@/app/(dashboard)/s/[space]/settings/page";
import SettingsLayout from "@/app/(dashboard)/s/[space]/settings/layout";
import StoragePage from "@/app/(dashboard)/s/[space]/settings/storage/page";
import { StorageSettings } from "@/components/storage/storage-settings";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import type { StorageSettingsView } from "@/lib/storage/settings-view";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { joinSpace } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { act, fireEvent, render, screen, waitFor, within } from "../helpers/dom";

class NotFound extends Error {}
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
const at = vi.hoisted(() => ({ path: "/s/personal/settings/storage" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => at.path,
  notFound: () => {
    throw new NotFound();
  },
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  unstable_rethrow: () => {},
}));
const { signedIn, choose } = vi.hoisted(() => ({ signedIn: { user: null as CurrentUser | null }, choose: vi.fn(async () => ({})) }));
vi.mock("@/app/(dashboard)/s/[space]/settings/storage/actions", () => ({ chooseConnectionAction: choose }));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));

const PERSONAL = { id: "personal_u1", slug: "personal", name: "Personal", kind: "personal" as const };
const TEAM = { id: "team_robots", slug: "robots", name: "Robots", kind: "team" as const };
const SEED = { id: SEED_TEAM_ID, slug: "seattle-solvers", name: "Seattle Solvers", kind: "team" as const };
const GiB = 1024 ** 3;
const inAccount = (over: Partial<Extract<StorageSettingsView["storage"], { kind: "google_account" }>> = {}): StorageSettingsView["storage"] => ({
  kind: "google_account",
  email: "ada@gmail.com",
  folderName: "EasyEdit – Personal",
  broken: false,
  hasUploads: false,
  usage: { usedBytes: Math.round(12.4 * GiB), limitBytes: 15 * GiB },
  ...over,
});

function show(view: Partial<StorageSettingsView> = {}, extra: { note?: string | null; first?: boolean; choose?: typeof choose } = {}) {
  const full: StorageSettingsView = { space: PERSONAL, storage: { kind: "none" }, connections: [], blocked: null, ...view };
  return render(<StorageSettings view={full} note={extra.note ?? null} first={extra.first ?? false} choose={extra.choose ?? choose} />);
}

const link = (name: string) => screen.getByRole<HTMLAnchorElement>("link", { name });
const button = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });
// Where a link to /api/storage/connect goes, as its query.
const connectQuery = (name: string) => {
  const url = new URL(link(name).getAttribute("href")!, "https://app.test");
  expect(url.pathname).toBe("/api/storage/connect");
  return Object.fromEntries(url.searchParams);
};
const isPrimary = (element: HTMLElement) => element.className.split(/\s+/).includes("bg-ed-accent");

beforeEach(() => {
  router.replace.mockClear();
  router.refresh.mockClear();
  choose.mockReset();
  choose.mockResolvedValue({});
});

describe("the storage settings", () => {
  it("Seattle Solvers: its shared drive, and nothing to change", () => {
    show({ space: SEED, storage: { kind: "shared_folder" } });
    expect(screen.getByText("Stored in the team's shared drive.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a Google account: whose Drive, the folder, how full it is, Reconnect and Use a different Google account", () => {
    show({ storage: inAccount() });
    expect(screen.getByText("Stored in ada@gmail.com's Google Drive")).toBeTruthy();
    expect(screen.getByText('Folder "EasyEdit – Personal"')).toBeTruthy();
    expect(screen.getByText("12.4 GB of 15 GB used")).toBeTruthy();
    expect(connectQuery("Reconnect")).toEqual({ space: "personal_u1", hint: "ada@gmail.com" });
    expect(isPrimary(link("Reconnect"))).toBe(false);
    expect(connectQuery("Use a different Google account")).toEqual({ space: "personal_u1" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("with no usage known, there is no usage line", () => {
    show({ storage: inAccount({ usage: null }) });
    expect(screen.queryByText(/used$/)).toBeNull();
    expect(screen.getByText("Stored in ada@gmail.com's Google Drive")).toBeTruthy();
  });

  it("a broken connection: says uploads are paused, and Reconnect leads", () => {
    show({ storage: inAccount({ broken: true, usage: null }) });
    expect(screen.getByRole("alert").textContent).toBe("Google Drive needs reconnecting. Uploads are paused until you reconnect it.");
    expect(isPrimary(link("Reconnect"))).toBe(true);
  });

  it("a space with uploads can't move to another account yet, and says why", () => {
    show({ storage: inAccount({ hasUploads: true }) });
    const different = button("Use a different Google account");
    expect(different.disabled).toBe(true);
    expect(screen.queryByRole("link", { name: "Use a different Google account" })).toBeNull();
    expect(screen.getByText("Moving a space's videos to another account comes with team invites.")).toBeTruthy();
    expect(link("Reconnect")).toBeTruthy();
  });

  it("none, with no connection yet: Connect Google Drive", () => {
    show();
    expect(screen.getByText("Pick a Google account for your own videos.")).toBeTruthy();
    expect(connectQuery("Connect Google Drive")).toEqual({ space: "personal_u1" });
    expect(isPrimary(link("Connect Google Drive"))).toBe(true);
    expect(screen.queryByRole("link", { name: "Use a different Google account" })).toBeNull();
  });

  it("none, with the person's connections: Use <email> for each, and Use a different Google account", async () => {
    show({ connections: [{ id: "dc_1", email: "ada@gmail.com", broken: false }, { id: "dc_2", email: "ada.school@gmail.com", broken: false }] });
    expect(button("Use ada@gmail.com")).toBeTruthy();
    expect(button("Use ada.school@gmail.com")).toBeTruthy();
    expect(connectQuery("Use a different Google account")).toEqual({ space: "personal_u1" });
    expect(screen.queryByRole("link", { name: "Connect Google Drive" })).toBeNull();

    await act(async () => fireEvent.click(button("Use ada.school@gmail.com")));
    expect(choose).toHaveBeenCalledTimes(1);
    expect((choose.mock.calls[0] as unknown as [FormData])[0].get("connectionId")).toBe("dc_2");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/s/personal/settings/storage?storage=connected"));
  });

  it("a connection Google ended goes back through Google, for that account", () => {
    show({ connections: [{ id: "dc_1", email: "ada@gmail.com", broken: true }] });
    expect(connectQuery("Use ada@gmail.com")).toEqual({ space: "personal_u1", hint: "ada@gmail.com" });
  });

  it("a choice that is refused says why, and can be tried again", async () => {
    choose.mockResolvedValueOnce({ error: "Team storage isn't set up on this server yet." });
    show({ space: TEAM, connections: [{ id: "dc_1", email: "ada@gmail.com", broken: false }] });
    await act(async () => fireEvent.click(button("Use ada@gmail.com")));
    expect((await screen.findByRole("alert")).textContent).toBe("Team storage isn't set up on this server yet.");
    expect(button("Use ada@gmail.com").disabled).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a team without storage: the first-run note above the choices", () => {
    const first = show({ space: TEAM }, { first: true });
    const note = screen.getByText("Choose where this team's videos are stored.");
    const connect = link("Connect Google Drive");
    expect(note.compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    first.unmount();
    show({ space: TEAM });
    expect(screen.getByText("This team has no storage yet.")).toBeTruthy();
    expect(screen.queryByText("Choose where this team's videos are stored.")).toBeNull();
  });

  it("a server with no storage settings: says so, and sends nobody to Google", () => {
    const none = show({ blocked: "server", connections: [{ id: "dc_1", email: "ada@gmail.com", broken: false }] });
    expect(screen.getByText("Storage isn't set up on this server yet.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    none.unmount();
    show({ blocked: "server", storage: inAccount({ usage: null }) });
    expect(screen.getByText("Stored in ada@gmail.com's Google Drive")).toBeTruthy();
    expect(screen.getByText("Storage isn't set up on this server yet.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("team storage not set up on this server: says so; a team already in an account can still reconnect", () => {
    const none = show({ space: TEAM, blocked: "team", connections: [{ id: "dc_1", email: "ada@gmail.com", broken: false }] });
    expect(screen.getByText("Team storage isn't set up on this server yet.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    none.unmount();
    show({ space: TEAM, blocked: "team", storage: inAccount({ folderName: "EasyEdit – Robots" }) });
    expect(connectQuery("Reconnect")).toEqual({ space: "team_robots", hint: "ada@gmail.com" });
    expect(button("Use a different Google account").disabled).toBe(true);
    expect(screen.getByText("Team storage isn't set up on this server yet.")).toBeTruthy();
  });

  it.each([
    ["connected", "Google Drive connected."],
    ["needs-drive", "EasyEdit needs permission to its own files in your Drive. Try again and leave that box ticked."],
    ["cancelled", "Nothing was changed."],
    ["failed", "That didn't work. Nothing was changed. Try again."],
    ["expired", "That took too long, so nothing was changed. Try again."],
    ["not-configured", "Storage isn't set up on this server yet."],
  ])("back from Google with ?storage=%s, it says so", (note, text) => {
    show({ storage: inAccount() }, { note });
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("an unknown note says nothing", () => {
    const { container } = show({ storage: inAccount() }, { note: "<b>hi</b>" });
    expect(container.textContent).not.toContain("hi");
  });
});

// The pages, on a real database. With no storage settings in the environment, nothing reaches Google.
const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: null };
const bea: CurrentUser = { id: "u2", email: "bea@gmail.com", name: "Bea", image: null, allowlistRole: null };
const out: CurrentUser = { id: "u3", email: "out@gmail.com", name: "Out", image: null, allowlistRole: null };

async function storagePage(person: CurrentUser, slug: string, searchParams: Record<string, string> = {}) {
  signedIn.user = person;
  return render(await StoragePage({ params: Promise.resolve({ space: slug }), searchParams: Promise.resolve(searchParams) } as never));
}
async function layout(person: CurrentUser, slug: string) {
  signedIn.user = person;
  return render(await SettingsLayout({ params: Promise.resolve({ space: slug }), children: <p>inside</p> } as never));
}

describe("the storage settings page", () => {
  beforeEach(async () => {
    vi.stubEnv("STORAGE_TOKEN_KEY", "");
    testDb = await makeTestDb();
    for (const person of [ada, bea, out]) await joinSpace(testDb, person, "admin", personalSpaceId(person.id));
    await joinSpace(testDb, ada, "admin");
    await joinSpace(testDb, bea, "editor");
    await testDb.execute(sql`insert into organization (id, name, slug, created_at, kind) values ('team_robots', 'Robots', 'robots', now(), 'team')`);
    await joinSpace(testDb, ada, "admin", "team_robots");
    await joinSpace(testDb, bea, "editor", "team_robots");
    return () => vi.unstubAllEnvs();
  });

  it("an admin sees the space's storage; here, a server with no storage settings", async () => {
    await storagePage(ada, "personal");
    expect(screen.getByText("Storage isn't set up on this server yet.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Connect Google Drive" })).toBeNull();
  });

  it("Seattle Solvers' admins see its shared drive", async () => {
    await storagePage(ada, "seattle-solvers");
    expect(screen.getByText("Stored in the team's shared drive.")).toBeTruthy();
  });

  it("reads the note and the first-run flag from the address", async () => {
    await storagePage(ada, "robots", { storage: "cancelled", first: "1" });
    expect(screen.getByText("Nothing was changed.")).toBeTruthy();
    expect(screen.getByText("Choose where this team's videos are stored.")).toBeTruthy();
  });

  it("a member who isn't an admin, and someone not in the space, get not found, from the page and the layout", async () => {
    await expect(storagePage(bea, "robots")).rejects.toBeInstanceOf(NotFound);
    await expect(storagePage(bea, "seattle-solvers")).rejects.toBeInstanceOf(NotFound);
    await expect(storagePage(out, "robots")).rejects.toBeInstanceOf(NotFound);
    await expect(storagePage(ada, personalSpaceId("u2"))).rejects.toBeInstanceOf(NotFound);
    await expect(storagePage(ada, "no-such-team")).rejects.toBeInstanceOf(NotFound);
    await expect(layout(bea, "robots")).rejects.toBeInstanceOf(NotFound);
    await expect(layout(out, "robots")).rejects.toBeInstanceOf(NotFound);
  });

  it("the layout: the space's name, a way back, and a row of tabs with Storage", async () => {
    at.path = "/s/robots/settings/storage";
    await layout(ada, "robots");
    expect(screen.getByRole("heading", { level: 1, name: "Robots" })).toBeTruthy();
    expect(link("Back to projects").getAttribute("href")).toBe("/s/robots");
    const tabs = screen.getByRole("navigation", { name: "Settings" });
    const storage = within(tabs).getByRole("link", { name: "Storage" });
    expect(storage.getAttribute("href")).toBe("/s/robots/settings/storage");
    expect(storage.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("inside")).toBeTruthy();
  });

  it("a personal space's settings are named Personal", async () => {
    at.path = "/s/personal/settings/storage";
    await layout(ada, "personal");
    expect(screen.getByRole("heading", { level: 1, name: "Personal" })).toBeTruthy();
  });

  it("/s/<space>/settings opens Storage", async () => {
    await expect(SettingsIndex({ params: Promise.resolve({ space: "robots" }) } as never)).rejects.toMatchObject({ to: "/s/robots/settings/storage" });
  });
});
