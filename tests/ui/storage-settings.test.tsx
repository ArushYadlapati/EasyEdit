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
const { signedIn, disconnect } = vi.hoisted(() => ({ signedIn: { user: null as CurrentUser | null }, disconnect: vi.fn(async () => ({})) }));
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
  ownedByViewer: true,
  ownerEmail: "ada@gmail.com",
  ...over,
});

function show(view: Partial<StorageSettingsView> = {}, extra: { note?: string | null; first?: boolean } = {}) {
  const full: StorageSettingsView = { space: PERSONAL, storage: { kind: "none" }, connections: [], blocked: null, ...view };
  return render(<StorageSettings view={full} note={extra.note ?? null} first={extra.first ?? false} disconnect={disconnect} />);
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
  disconnect.mockReset();
  disconnect.mockResolvedValue({});
  router.refresh.mockClear();
});

const WHY = "Videos, pictures and audio you upload are kept in Google Drive, in a folder EasyEdit makes. It can't see anything else there. Until you connect one you can still make text-only videos.";

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
    expect(screen.getByText("Moving a space's uploads to another Google account isn't built yet, so it keeps this one while it has uploads.")).toBeTruthy();
    expect(link("Reconnect")).toBeTruthy();
  });

  it("none: one Connect Google Drive, through Google's own account picker, with the one-space rule", () => {
    show();
    expect(screen.getByText("Videos, pictures and audio you upload are kept in Google Drive, in a folder EasyEdit makes. It can't see anything else there. Until you connect one you can still make text-only videos.")).toBeTruthy();
    expect(connectQuery("Connect Google Drive")).toEqual({ space: "personal_u1" });
    expect(isPrimary(link("Connect Google Drive"))).toBe(true);
    expect(
      screen.getByText("Each Google account can hold uploads for only one space: your Personal space or one team. Pick one that isn't already in use."),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Use a different Google account" })).toBeNull();
  });

  it("none, with the person's connections: still only Connect Google Drive, never a Use <email> per account", () => {
    // A connected account may already hold another space's storage, so none is offered as a one-click choice.
    show({ space: TEAM, connections: [{ id: "dc_1", email: "ada@gmail.com", broken: false }, { id: "dc_2", email: "ada.school@gmail.com", broken: true }] });
    expect(connectQuery("Connect Google Drive")).toEqual({ space: "team_robots" });
    expect(screen.queryByText(/Use ada/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("a team without storage: the first-run note above the choices", () => {
    const first = show({ space: TEAM }, { first: true });
    const note = screen.getByText("Connect Google Drive for this team's uploads");
    const connect = link("Connect Google Drive");
    expect(note.compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // What storage is, and the one-account rule, come before the button, not under it.
    for (const fact of [screen.getByText(WHY), screen.getByText(/Each Google account can hold uploads for only one space/)]) {
      expect(fact.compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    first.unmount();
    show({ space: TEAM });
    expect(screen.getByText("This team has no storage yet.")).toBeTruthy();
    expect(screen.queryByText("Connect Google Drive for this team's uploads")).toBeNull();
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

  it("blocked on this server, a space with none says only that: no instructions, nothing to press", () => {
    show({ blocked: "server", connections: [{ id: "dc_1", email: "ada@gmail.com", broken: false }] });
    expect(screen.getByText("No storage yet.")).toBeTruthy();
    expect(screen.getByText("Storage isn't set up on this server yet.")).toBeTruthy();
    expect(screen.queryByText("Videos, pictures and audio you upload are kept in Google Drive, in a folder EasyEdit makes. It can't see anything else there. Until you connect one you can still make text-only videos.")).toBeNull();
    expect(screen.queryByText(/folder of its own/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a team just made, blocked on this server: it's ready, and the way on is its projects", () => {
    show({ space: TEAM, blocked: "server" }, { first: true });
    expect(screen.getByText("Your team is ready. You can add videos once storage is set up on this server.")).toBeTruthy();
    expect(screen.queryByText("Connect Google Drive for this team's uploads")).toBeNull();
    const onward = link("Go to the team's projects");
    expect(onward.getAttribute("href")).toBe("/s/robots");
    expect(isPrimary(onward)).toBe(true);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a team just made, not blocked: the note, the choices, and Set this up later", () => {
    show({ space: TEAM }, { first: true });
    expect(screen.getByText("Connect Google Drive for this team's uploads")).toBeTruthy();
    expect(link("Connect Google Drive")).toBeTruthy();
    const later = link("Set this up later");
    expect(later.getAttribute("href")).toBe("/s/robots");
    expect(isPrimary(later)).toBe(false);
  });

  it("Disconnect, for the person who connected it: asks first, then shows the space with no storage", async () => {
    show({ storage: inAccount({ hasUploads: false }) });
    await act(async () => fireEvent.click(button("Disconnect")));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Disconnect ada@gmail.com?")).toBeTruthy();
    expect(within(dialog).getByText(/The EasyEdit folder stays in your Google Drive\./)).toBeTruthy();
    expect(disconnect).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" })));
    expect(disconnect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/s/personal/settings/storage?storage=disconnected"));
  });

  it("a refused Disconnect says why in the dialog, and stays on the page", async () => {
    disconnect.mockResolvedValueOnce({ error: "This space has uploads in that Google Drive, so it can't be disconnected. Moving them to another account isn't built yet." });
    show({ storage: inAccount({ hasUploads: false }) });
    await act(async () => fireEvent.click(button("Disconnect")));
    const dialog = screen.getByRole("dialog");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" })));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("This space has uploads in that Google Drive, so it can't be disconnected. Moving them to another account isn't built yet.");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a space with videos: Disconnect is off, and says why", () => {
    show({ storage: inAccount({ hasUploads: true }) });
    expect(button("Disconnect").disabled).toBe(true);
    expect(screen.getByText("This space has uploads in that Google Drive, so it can't be disconnected. Moving them to another account isn't built yet.")).toBeTruthy();
  });

  it("no Disconnect for an admin who didn't connect the account, or on a server without storage settings", () => {
    const other = show({ space: TEAM, storage: inAccount({ ownedByViewer: false, ownerEmail: "bea@gmail.com" }) });
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    other.unmount();
    show({ blocked: "server", storage: inAccount() });
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  it("after a disconnect, the note says the folder is still in their Drive", () => {
    show({}, { note: "disconnected" });
    expect(screen.getByText("Google account disconnected. Its EasyEdit folder is still in your Google Drive.")).toBeTruthy();
  });

  it("an admin who didn't connect the account is told who can reconnect it, not given a Reconnect that can't work", () => {
    const other = show({ space: TEAM, storage: inAccount({ broken: true, ownedByViewer: false, ownerEmail: "bea@gmail.com" }) });
    expect(screen.queryByRole("link", { name: "Reconnect" })).toBeNull();
    expect(screen.getByText("Only bea@gmail.com can reconnect it.")).toBeTruthy();
    expect(connectQuery("Use a different Google account")).toEqual({ space: "team_robots" }); // left as it is
    other.unmount();
    show({ space: TEAM, storage: inAccount({ ownedByViewer: false, ownerEmail: null }) });
    expect(screen.queryByRole("link", { name: "Reconnect" })).toBeNull();
    expect(screen.getByText("Only the person who connected it can reconnect it.")).toBeTruthy();
  });

  it.each([
    ["connected", "Google Drive connected."],
    ["needs-drive", "EasyEdit needs permission to its own files in your Drive. Try again and leave that box ticked."],
    ["cancelled", "Nothing was changed."],
    ["failed", "That didn't work. Nothing was changed. Try again."],
    ["expired", "That took too long, so nothing was changed. Try again."],
    ["not-configured", "Storage isn't set up on this server yet."],
    ["in-use", "This space already has uploads in another Google account. Moving them to a new account isn't built yet, so nothing was changed."],
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
    // On this server teams can't have storage, so a team just made is told it's ready and sent on to its projects.
    await storagePage(ada, "robots", { storage: "cancelled", first: "1" });
    expect(screen.getByText("Nothing was changed.")).toBeTruthy();
    expect(screen.getByText("Your team is ready. You can add videos once storage is set up on this server.")).toBeTruthy();
    expect(screen.queryByText("Connect Google Drive for this team's uploads")).toBeNull();
    expect(link("Go to the team's projects").getAttribute("href")).toBe("/s/robots");
  });

  it("a member who isn't an admin, and someone not in the space, get not found; the layout lets only members in", async () => {
    await expect(storagePage(bea, "robots")).rejects.toBeInstanceOf(NotFound);
    await expect(storagePage(bea, "seattle-solvers")).rejects.toBeInstanceOf(NotFound);
    await expect(storagePage(out, "robots")).rejects.toBeInstanceOf(NotFound);
    await expect(storagePage(ada, personalSpaceId("u2"))).rejects.toBeInstanceOf(NotFound);
    await expect(storagePage(ada, "no-such-team")).rejects.toBeInstanceOf(NotFound);
    await expect(layout(out, "robots")).rejects.toBeInstanceOf(NotFound);
  });

  it("the layout: the space's name, a way back, and a row of tabs with Members and Storage", async () => {
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

  it("/s/<space>/settings opens a personal space's Storage", async () => {
    signedIn.user = ada;
    await expect(SettingsIndex({ params: Promise.resolve({ space: "personal" }) } as never)).rejects.toMatchObject({ to: "/s/personal/settings/storage" });
  });
});
