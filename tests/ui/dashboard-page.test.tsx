// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardLayout, { metadata, viewport } from "@/app/(dashboard)/layout";
import DashboardPage from "@/app/(dashboard)/dashboard/page";
import {
  createFolderAction,
  createProjectAction,
  deleteFolderAction,
  deleteProjectAction,
  duplicateProjectAction,
  moveProjectAction,
  renameFolderAction,
  renameProjectAction,
} from "@/app/(dashboard)/dashboard/actions";
import type { DashboardProps } from "@/components/dashboard/dashboard";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { createFolder } from "@/lib/projects/folders";
import { recordOpen } from "@/lib/projects/opens";
import { createProject } from "@/lib/projects/service";
import { saveThumbnail } from "@/lib/projects/thumbnails";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { render, screen } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, unstable_rethrow: () => {} }));

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
  createFolderAction: vi.fn(),
  renameFolderAction: vi.fn(),
  deleteFolderAction: vi.fn(),
}));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));
vi.mock("@/components/keep-signed-in", () => ({ KeepSignedIn }));

// Each one's role in Seattle Solvers is their allowlist role.
const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada Lovelace", image: null, allowlistRole: "editor" };
const vic: CurrentUser = { id: "u2", email: "vic@gmail.com", name: "Vic", image: null, allowlistRole: "viewer" };
const admin: CurrentUser = { id: "u3", email: "root@gmail.com", name: "Root", image: null, allowlistRole: "admin" };
const as = (person: CurrentUser) => testActor({ userId: person.id, email: person.email, role: person.allowlistRole });

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
    await DashboardPage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) } as never),
  );
  unmount();
  expect(Dashboard).toHaveBeenCalledTimes(1);
  return Dashboard.mock.calls[0][0] as DashboardProps;
}

describe("the dashboard page", () => {
  it("the page hands the dashboard every action under its own name", async () => {
    const props = await dashboardFor(ada);
    expect(props.actions).toStrictEqual({
      create: createProjectAction,
      rename: renameProjectAction,
      remove: deleteProjectAction,
      duplicate: duplicateProjectAction,
      move: moveProjectAction,
      createFolder: createFolderAction,
      renameFolder: renameFolderAction,
      deleteFolder: deleteFolderAction,
    });
    expect(props.canEdit).toBe(true);
    expect(props.projects.map((p) => [p.id, p.name, p.changedBy])).toEqual([[projectId, "Qual recap", "Ada Lovelace"]]);
    expect(props.folders).toEqual([]);
    expect(props.view).toBeNull();
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

  it("the address picks the folder, and an unknown one is the main view", async () => {
    expect((await dashboardFor(ada, { folder: "nope" })).view).toBeNull();
    const folder = await createFolder(testDb, as(ada), "Season 2026");
    const props = await dashboardFor(ada, { folder: folder.id });
    expect(props.view).toBe(folder.id);
    expect(props.folders).toEqual([{ id: folder.id, name: "Season 2026", projectCount: 0 }]);
  });

  it("the header shows Admin only to admins, and opts out of Dark Reader", async () => {
    signedIn.user = admin;
    KeepSignedIn.mockClear();
    const first = render(await DashboardLayout({ children: <p>x</p> } as never));
    expect(first.container.firstElementChild?.className).toContain("ed-theme");
    expect(KeepSignedIn).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Admin" }).getAttribute("href")).toBe("/admin");
    expect(screen.getByText("x")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Account" }).textContent).toContain("Root");
    first.unmount();
    signedIn.user = { ...ada, name: "" };
    render(await DashboardLayout({ children: <p>x</p> } as never));
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    // With no name, the email stands in.
    expect(screen.getByRole("button", { name: "Account" }).textContent).toContain("ada@gmail.com");
    expect(metadata.other).toEqual({ "darkreader-lock": "true" });
    expect(viewport).toEqual({ colorScheme: "dark" });
  });
});
