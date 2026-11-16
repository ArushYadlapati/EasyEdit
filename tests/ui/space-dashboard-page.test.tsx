// @vitest-environment happy-dom
import type { Role } from "@/lib/allowlist/service";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardLayout, { metadata, viewport } from "@/app/(dashboard)/layout";
import DashboardPage from "@/app/(dashboard)/s/[space]/page";
import {
  createFolderAction,
  createProjectAction,
  deleteFolderAction,
  deleteProjectAction,
  duplicateProjectAction,
  moveProjectAction,
  pinProjectAction,
  renameFolderAction,
  renameProjectAction,
  unpinProjectAction,
} from "@/app/(dashboard)/dashboard/actions";
import type { DashboardProps } from "@/components/dashboard/dashboard";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { createFolder } from "@/lib/projects/folders";
import { recordOpen } from "@/lib/projects/opens";
import { pinProject } from "@/lib/projects/pins";
import { createProject } from "@/lib/projects/service";
import { saveThumbnail } from "@/lib/projects/thumbnails";
import { SEED_TEAM_ID, personalSpaceId } from "@/lib/spaces/types";
import { hasSeenTutorial, markTutorialSeen } from "@/lib/tutorial/seen";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { fireEvent, render, screen } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
const at = vi.hoisted(() => ({ path: "/s/seattle-solvers" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => at.path, unstable_rethrow: () => {} }));

const { Dashboard, KeepSignedIn, signedIn } = vi.hoisted(() => ({
  Dashboard: vi.fn<(props: unknown) => null>(() => null),
  KeepSignedIn: vi.fn<() => null>(() => null),
  signedIn: { user: null as CurrentUser | null },
}));
vi.mock("@/components/dashboard/dashboard", () => ({ Dashboard }));
vi.mock("@/app/(dashboard)/dashboard/actions", () => ({
  createProjectAction: vi.fn(),
  renameProjectAction: vi.fn(),
  deleteProjectAction: vi.fn(),
  duplicateProjectAction: vi.fn(),
  moveProjectAction: vi.fn(),
  pinProjectAction: vi.fn(),
  unpinProjectAction: vi.fn(),
  createFolderAction: vi.fn(),
  renameFolderAction: vi.fn(),
  deleteFolderAction: vi.fn(),
}));
const jar = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name in jar.values ? { name, value: jar.values[name] } : undefined) }) }));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));
vi.mock("@/components/keep-signed-in", () => ({ KeepSignedIn }));
// The real lookup, watched, to see when the frame asks whether someone has seen the tutorial.
vi.mock("@/lib/tutorial/seen", async (orig) => {
  const real = await orig<typeof import("@/lib/tutorial/seen")>();
  return { ...real, hasSeenTutorial: vi.fn(real.hasSeenTutorial) };
});

// Each one's role in Seattle Solvers is their allowlist role.
const ada: CurrentUser & { allowlistRole: Role } = { id: "u1", email: "ada@gmail.com", name: "Ada Lovelace", image: null, allowlistRole: "editor" };
const vic: CurrentUser & { allowlistRole: Role } = { id: "u2", email: "vic@gmail.com", name: "Vic", image: null, allowlistRole: "viewer" };
const admin: CurrentUser & { allowlistRole: Role } = { id: "u3", email: "root@gmail.com", name: "Root", image: null, allowlistRole: "admin" };
const as = (person: CurrentUser & { allowlistRole: Role }) => testActor({ userId: person.id, email: person.email, role: person.allowlistRole });

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

let projectId: string;

beforeEach(async () => {
  router.push.mockClear();
  router.replace.mockClear();
  router.refresh.mockClear();
  router.bfcacheId = "b0";
  Dashboard.mockClear();
  testDb = await makeTestDb();
  await testDb.insert(user).values([
    { id: "u1", name: "Ada Lovelace", email: "ada@gmail.com" },
    { id: "u2", name: "Vic", email: "vic@gmail.com" },
  ]);
  for (const person of [ada, vic]) await joinSpace(testDb, person, person.allowlistRole);
  projectId = (await createProject(testDb, as(ada), { name: "Qual recap", format: "short_9x16" })).id;
});

// The page as this person sees it at this address; the props it handed the dashboard.
async function dashboardFor(person: CurrentUser, searchParams: Record<string, string> = {}): Promise<DashboardProps> {
  signedIn.user = person;
  Dashboard.mockClear();
  const { unmount } = render(
    await DashboardPage({ params: Promise.resolve({ space: "seattle-solvers" }), searchParams: Promise.resolve(searchParams) } as never),
  );
  unmount();
  expect(Dashboard).toHaveBeenCalledTimes(1);
  return Dashboard.mock.calls[0][0] as DashboardProps;
}

describe("the dashboard page", () => {
  it("the page hands the dashboard every action under its own name", async () => {
    const props = await dashboardFor(ada);
    const pairs = [
      ["create", createProjectAction],
      ["rename", renameProjectAction],
      ["remove", deleteProjectAction],
      ["duplicate", duplicateProjectAction],
      ["move", moveProjectAction],
      ["pin", pinProjectAction],
      ["unpin", unpinProjectAction],
      ["createFolder", createFolderAction],
      ["renameFolder", renameFolderAction],
      ["deleteFolder", deleteFolderAction],
    ] as const;
    expect(Object.keys(props.actions).sort()).toEqual(pairs.map(([key]) => key).sort());
    // Each is the server action with the page's space bound as its first argument.
    for (const [key, action] of pairs) {
      vi.mocked(action).mockClear();
      await (props.actions[key] as (...args: unknown[]) => unknown)("arg");
      expect(vi.mocked(action)).toHaveBeenCalledWith(SEED_TEAM_ID, "arg");
    }
    expect(props.canEdit).toBe(true);
    expect(props.projects.map((p) => [p.id, p.name, p.changedBy])).toEqual([[projectId, "Qual recap", "Ada Lovelace"]]);
    expect(props.folders).toEqual([]);
    expect(props.view).toEqual({ kind: "all" }); // nothing opened here yet
    expect(props.now).toBeInstanceOf(Date);
  });

  it("the dashboard gets each project's picture version, never its bytes", async () => {
    await saveThumbnail(testDb, as(ada), projectId, 0, JPEG);
    const props = await dashboardFor(ada);
    expect(props.projects[0].thumbnailVersion).toBe(0);
    expect(Object.keys(props.projects[0])).not.toContain("thumbnail");
  });

  it("a viewer's page has no edit controls and their own Recent", async () => {
    await recordOpen(testDb, as(vic), projectId);
    const viewer = await dashboardFor(vic);
    expect(viewer.canEdit).toBe(false);
    expect(viewer.recentIds).toEqual([projectId]);
    expect((await dashboardFor(ada)).recentIds).toEqual([]);
  });

  it("the sidebar gets this browser's folded sections, so the first paint has them", async () => {
    jar.values = {};
    expect((await dashboardFor(ada)).sidebarCollapsed).toBeUndefined();
    jar.values = { easyedit_sidebar: "folders.pinned" };
    expect((await dashboardFor(ada)).sidebarCollapsed).toBe("folders.pinned");
    jar.values = {};
  });

  it("everyone in the space gets its pins", async () => {
    expect((await dashboardFor(vic)).pinnedIds).toEqual([]);
    await pinProject(testDb, as(ada), projectId);
    expect((await dashboardFor(vic)).pinnedIds).toEqual([projectId]);
    expect((await dashboardFor(ada)).pinnedIds).toEqual([projectId]);
  });

  it("a first visit, with nothing opened in the space, lands on All projects; with something opened, on Recent", async () => {
    expect((await dashboardFor(ada)).view).toEqual({ kind: "all" });
    // Asking for Recent by name still shows it, with its empty text.
    expect((await dashboardFor(ada, { view: "recent" })).view).toEqual({ kind: "recent" });
    await recordOpen(testDb, as(ada), projectId);
    expect((await dashboardFor(ada)).view).toEqual({ kind: "recent" });
    expect((await dashboardFor(ada, { view: "all" })).view).toEqual({ kind: "all" });
  });

  it("the address picks Recent, All projects or a folder; an unknown folder is the landing view", async () => {
    expect((await dashboardFor(ada, { folder: "nope" })).view).toEqual({ kind: "all" });
    await recordOpen(testDb, as(ada), projectId);
    expect((await dashboardFor(ada, { folder: "nope" })).view).toEqual({ kind: "recent" });
    expect((await dashboardFor(ada, { view: "all" })).view).toEqual({ kind: "all" });
    const folder = await createFolder(testDb, as(ada), "Season 2026");
    const props = await dashboardFor(ada, { folder: folder.id });
    expect(props.view).toEqual({ kind: "folder", folderId: folder.id });
    expect(props.folders).toEqual([{ id: folder.id, name: "Season 2026", projectCount: 0 }]);
  });

  it("the header shows Admin only to admins, only in Seattle Solvers, and opts out of Dark Reader", async () => {
    await joinSpace(testDb, admin, "admin");
    await joinSpace(testDb, admin, "admin", personalSpaceId(admin.id));
    signedIn.user = admin;
    KeepSignedIn.mockClear();
    at.path = "/s/seattle-solvers";
    const first = render(await DashboardLayout({ children: <p>x</p> } as never));
    expect(first.container.firstElementChild?.className).toContain("ed-theme");
    expect(KeepSignedIn).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Admin" }).getAttribute("href")).toBe("/admin");
    expect(screen.getByText("x")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Account" }).textContent).toContain("Root");
    first.unmount();
    // Not in their personal space.
    at.path = "/s/personal";
    const personal = render(await DashboardLayout({ children: <p>x</p> } as never));
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    personal.unmount();
    at.path = "/s/seattle-solvers";
    signedIn.user = { ...ada, name: "" };
    render(await DashboardLayout({ children: <p>x</p> } as never));
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    // With no name, the email stands in.
    expect(screen.getByRole("button", { name: "Account" }).textContent).toContain("ada@gmail.com");
    expect(metadata.other).toEqual({ "darkreader-lock": "true" });
    expect(viewport).toEqual({ colorScheme: "dark" });
  });
});

describe("the tutorial in the dashboard's frame", () => {
  const frame = async () => render(await DashboardLayout({ children: <p>x</p> } as never));
  const welcome = () => screen.queryByRole("dialog", { name: "Welcome to EasyEdit" });
  const menuItems = () => {
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    return screen.getAllByRole("menuitem").map((item) => item.textContent);
  };

  beforeEach(() => {
    signedIn.user = ada;
    at.path = "/s/seattle-solvers";
    vi.mocked(hasSeenTutorial).mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("with no video on the server there is no welcome and no Tutorial item, and nobody is looked up", async () => {
    await frame();
    expect(welcome()).toBeNull();
    expect(menuItems()).toEqual(["Settings", "Passkeys", "AI agents", "Sign out"]);
    expect(hasSeenTutorial).not.toHaveBeenCalled();
  });

  it("with a video, someone who has not seen it is welcomed with it", async () => {
    vi.stubEnv("TUTORIAL_VIDEO_URL", "https://cdn.test/easyedit-intro.mp4");
    await frame();
    expect(welcome()).toBeTruthy();
    expect(document.querySelector("video")?.getAttribute("src")).toBe("https://cdn.test/easyedit-intro.mp4");
    expect(document.querySelector("video")?.getAttribute("poster")).toBe("https://cdn.test/easyedit-intro.jpg");
    expect(hasSeenTutorial).toHaveBeenCalledTimes(1);
  });

  it("with a video, someone who has seen it only gets the Tutorial item, and another person's mark does not count", async () => {
    vi.stubEnv("TUTORIAL_VIDEO_URL", "https://cdn.test/easyedit-intro.mp4");
    await markTutorialSeen(testDb, vic.id);
    const first = await frame();
    expect(welcome()).toBeTruthy();
    first.unmount();
    await markTutorialSeen(testDb, ada.id);
    await frame();
    expect(welcome()).toBeNull();
    expect(menuItems()).toEqual(["Settings", "Passkeys", "AI agents", "Tutorial", "Sign out"]);
  });

  it("when the seen marks cannot be read the dashboard still opens, with no welcome", async () => {
    vi.stubEnv("TUTORIAL_VIDEO_URL", "https://cdn.test/easyedit-intro.mp4");
    vi.mocked(hasSeenTutorial).mockRejectedValueOnce(new Error('relation "tutorial_views" does not exist'));
    await frame();
    expect(screen.getByText("x")).toBeTruthy();
    expect(welcome()).toBeNull();
    expect(menuItems()).toContain("Tutorial");
  });

  it("an address that is not a video link counts as no video", async () => {
    vi.stubEnv("TUTORIAL_VIDEO_URL", "http://cdn.test/easyedit-intro.mp4");
    await frame();
    expect(welcome()).toBeNull();
    expect(menuItems()).not.toContain("Tutorial");
  });
});
