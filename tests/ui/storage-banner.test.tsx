// @vitest-environment happy-dom
import { sql } from "drizzle-orm";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpacePage from "@/app/(dashboard)/s/[space]/page";
import type { DashboardProps } from "@/components/dashboard/dashboard";
import { Sidebar } from "@/components/dashboard/sidebar";
import { SpacesProvider } from "@/components/dashboard/space-switcher";
import { StorageBanner } from "@/components/storage/storage-banner";
import type { DB } from "@/db";
import { driveConnection, spaceStorage } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import type { Role } from "@/lib/allowlist/service";
import { personalSpaceId, SEED_TEAM_ID, type MySpace } from "@/lib/spaces/types";
import { joinSpace } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { render, screen, within } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/s/robots",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  unstable_rethrow: () => {},
}));
const { Dashboard, signedIn } = vi.hoisted(() => ({
  Dashboard: vi.fn<(props: unknown) => null>(() => null),
  signedIn: { user: null as CurrentUser | null },
}));
vi.mock("@/components/dashboard/dashboard", () => ({ Dashboard }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/app/(dashboard)/dashboard/actions", () => ({
  createProjectAction: vi.fn(), renameProjectAction: vi.fn(), deleteProjectAction: vi.fn(), duplicateProjectAction: vi.fn(),
  moveProjectAction: vi.fn(), pinProjectAction: vi.fn(), unpinProjectAction: vi.fn(), createFolderAction: vi.fn(), renameFolderAction: vi.fn(), deleteFolderAction: vi.fn(),
}));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));

const BANNER = "Google Drive needs reconnecting. Uploads are paused until an admin reconnects it.";

describe("the reconnect banner", () => {
  it("tells admins and editors uploads are paused; only admins get Reconnect", () => {
    const admin = render(<StorageBanner settingsHref="/s/robots/settings/storage" isAdmin isOwner ownerEmail="ada@gmail.com" />);
    expect(screen.getByText(BANNER)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reconnect" }).getAttribute("href")).toBe("/s/robots/settings/storage");
    admin.unmount();
    const editor = render(<StorageBanner settingsHref="/s/robots/settings/storage" isAdmin={false} isOwner={false} ownerEmail="ada@gmail.com" />);
    expect(screen.getByText(BANNER)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/can reconnect it/)).toBeNull();
    editor.unmount();
  });

  it("an admin who didn't connect it is told who can, in place of Reconnect", () => {
    const other = render(<StorageBanner settingsHref="/s/robots/settings/storage" isAdmin isOwner={false} ownerEmail="bea@gmail.com" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Only bea@gmail.com can reconnect it.")).toBeTruthy();
    other.unmount();
    render(<StorageBanner settingsHref="/s/robots/settings/storage" isAdmin isOwner={false} ownerEmail={null} />);
    expect(screen.getByText("Only the person who connected it can reconnect it.")).toBeTruthy();
  });
});

const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: null };
const bea: CurrentUser = { id: "u2", email: "bea@gmail.com", name: "Bea", image: null, allowlistRole: null };
const vic: CurrentUser = { id: "u3", email: "vic@gmail.com", name: "Vic", image: null, allowlistRole: null };

// The storage settings of a server that can connect Google accounts.
function withStorageSettings() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-1");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "shh");
  vi.stubEnv("STORAGE_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("BETTER_AUTH_URL", "https://app.test");
}

// What the dashboard page puts at the top of the dashboard, drawn on its own.
async function noticesFor(person: CurrentUser, slug: string, searchParams: Record<string, string> = {}): Promise<HTMLElement> {
  signedIn.user = person;
  Dashboard.mockClear();
  const page = render(await SpacePage({ params: Promise.resolve({ space: slug }), searchParams: Promise.resolve(searchParams) } as never));
  page.unmount();
  const props = Dashboard.mock.calls[0][0] as DashboardProps;
  return render(<div>{props.notices as ReactNode}</div>).container.firstElementChild as HTMLElement;
}

async function breakStorageOf(spaceId: string) {
  await testDb.insert(driveConnection).values({ id: "dc_1", userId: "u1", googleSub: "g1", email: "ada.drive@gmail.com", refreshTokenEnc: "sealed", scopes: "drive.file", brokenAt: new Date(), brokenReason: "revoked" });
  await testDb.insert(spaceStorage).values({ spaceId, kind: "google_account", connectionId: "dc_1", rootFolderId: "root1", folderName: "EasyEdit – x", createdBy: "u1" });
}

describe("the top of a space's dashboard", () => {
  beforeEach(async () => {
    testDb = await makeTestDb();
    for (const person of [ada, bea, vic]) await joinSpace(testDb, person, "admin", personalSpaceId(person.id));
    await joinSpace(testDb, ada, "editor");
    await testDb.execute(sql`insert into organization (id, name, slug, created_at, kind) values ('team_robots', 'Robots', 'robots', now(), 'team')`);
    const roles: [CurrentUser, Role][] = [[ada, "admin"], [bea, "editor"], [vic, "viewer"]];
    for (const [person, role] of roles) await joinSpace(testDb, person, role, "team_robots");
    return () => vi.unstubAllEnvs();
  });

  it("a personal space with no storage: the setup card, leading to storage settings", async () => {
    withStorageSettings();
    const top = await noticesFor(ada, "personal");
    expect(within(top).getByRole("heading", { name: "Connect Google Drive for your uploads" })).toBeTruthy();
    expect(within(top).getByText("Videos, pictures and audio you upload are kept in Google Drive, in a folder EasyEdit makes. It can't see anything else there. Until you connect one you can still make text-only videos.")).toBeTruthy();
    expect(within(top).getByRole("link", { name: "Connect Google Drive" }).getAttribute("href")).toBe("/s/personal/settings/storage");
  });

  it("a team with no storage: the card for its admins only", async () => {
    withStorageSettings();
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "p1");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", Buffer.from(JSON.stringify({ type: "service_account", client_email: "media@p1.iam.gserviceaccount.com", private_key: "k" })).toString("base64"));
    delete (globalThis as { __easyEditMainSa?: unknown }).__easyEditMainSa;
    try {
      const top = await noticesFor(ada, "robots");
      expect(within(top).getByRole("heading", { name: "Connect Google Drive for this team's uploads" })).toBeTruthy();
      expect(within(top).getByRole("link", { name: "Connect Google Drive" }).getAttribute("href")).toBe("/s/robots/settings/storage");
      expect((await noticesFor(bea, "robots")).textContent).toBe("");
    } finally {
      delete (globalThis as { __easyEditMainSa?: unknown }).__easyEditMainSa;
    }
  });

  it("no card where this server can't set storage up, or where there is storage", async () => {
    vi.stubEnv("STORAGE_TOKEN_KEY", "");
    expect((await noticesFor(ada, "personal")).textContent).toBe("");
    expect((await noticesFor(ada, "robots")).textContent).toBe(""); // no project for team readers either
    withStorageSettings();
    expect((await noticesFor(ada, "seattle-solvers")).textContent).toBe("");
  });

  it("a broken connection: the banner for admins (with Reconnect) and editors, not for viewers", async () => {
    withStorageSettings();
    await breakStorageOf("team_robots");
    const admin = await noticesFor(ada, "robots");
    expect(within(admin).getByText(BANNER)).toBeTruthy();
    expect(within(admin).getByRole("link", { name: "Reconnect" }).getAttribute("href")).toBe("/s/robots/settings/storage");
    expect(within(admin).queryByText("Connect Google Drive for this team's uploads")).toBeNull();
    const editor = await noticesFor(bea, "robots");
    expect(within(editor).getByText(BANNER)).toBeTruthy();
    expect(within(editor).queryByRole("link")).toBeNull();
    expect((await noticesFor(vic, "robots")).textContent).toBe("");
  });

  it("a broken connection made by someone else: its other admins are told who can reconnect it", async () => {
    withStorageSettings();
    await testDb.insert(driveConnection).values({ id: "dc_2", userId: "u2", googleSub: "g2", email: "bea.drive@gmail.com", refreshTokenEnc: "sealed", scopes: "drive.file", brokenAt: new Date(), brokenReason: "revoked" });
    await testDb.insert(spaceStorage).values({ spaceId: "team_robots", kind: "google_account", connectionId: "dc_2", rootFolderId: "root2", folderName: "EasyEdit – Robots", createdBy: "u2" });
    const admin = await noticesFor(ada, "robots");
    expect(within(admin).getByText(BANNER)).toBeTruthy();
    expect(within(admin).queryByRole("link", { name: "Reconnect" })).toBeNull();
    expect(within(admin).getByText("Only bea@gmail.com can reconnect it.")).toBeTruthy();
  });

  it("a personal space's broken connection: the banner with Reconnect", async () => {
    withStorageSettings();
    await breakStorageOf(personalSpaceId("u1"));
    const top = await noticesFor(ada, "personal");
    expect(within(top).getByText(BANNER)).toBeTruthy();
    expect(within(top).getByRole("link", { name: "Reconnect" }).getAttribute("href")).toBe("/s/personal/settings/storage");
  });

  it.each([
    ["refused", "That link to connect Google Drive didn't work. Start again from storage settings."],
    ["failed", "Connecting Google Drive didn't work. Try again from storage settings."],
  ])("back from connecting with ?storage=%s, it says so", async (note, text) => {
    const top = await noticesFor(ada, "seattle-solvers", { storage: note });
    expect(within(top).getByText(text)).toBeTruthy();
    expect((await noticesFor(ada, "seattle-solvers", { storage: "nonsense" })).textContent).toBe("");
  });
});

describe("the sidebar's link to storage", () => {
  const space = (id: string, slug: string, role: Role, kind: "personal" | "team" = "team"): MySpace => ({ id, slug, name: slug, kind, role });
  const sidebarIn = (spaces: MySpace[], spaceSlug: string) =>
    render(
      <SpacesProvider spaces={spaces}>
        <Sidebar folders={[]} view={{ kind: "recent" }} canEdit spaceSlug={spaceSlug} onNewFolder={() => {}} onDropProject={() => {}} />
      </SpacesProvider>,
    );

  it("admins get Storage under This space", () => {
    sidebarIn([space(personalSpaceId("u1"), personalSpaceId("u1"), "admin", "personal"), space("team_robots", "robots", "admin")], "robots");
    const nav = screen.getByRole("navigation", { name: "This space" });
    expect(within(nav).getByRole("heading", { name: "This space" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Storage" }).getAttribute("href")).toBe("/s/robots/settings/storage");
  });

  it("in a personal space too", () => {
    sidebarIn([space(personalSpaceId("u1"), personalSpaceId("u1"), "admin", "personal")], "personal");
    expect(screen.getByRole("link", { name: "Storage" }).getAttribute("href")).toBe("/s/personal/settings/storage");
  });

  it("editors and viewers don't (they get the team's Members only)", () => {
    const editor = sidebarIn([space(SEED_TEAM_ID, "seattle-solvers", "editor")], "seattle-solvers");
    expect(within(screen.getByRole("navigation", { name: "This space" })).getAllByRole("link").map((l) => l.textContent)).toEqual(["Members"]);
    expect(screen.queryByRole("link", { name: "Storage" })).toBeNull();
    editor.unmount();
    sidebarIn([space("team_robots", "robots", "viewer")], "robots");
    expect(screen.queryByRole("link", { name: "Storage" })).toBeNull();
  });
});
