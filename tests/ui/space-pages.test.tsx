// @vitest-environment happy-dom
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditorPage from "@/app/(editor)/s/[space]/editor/[id]/page";
import SpacePage from "@/app/(dashboard)/s/[space]/page";
import type { DashboardProps } from "@/components/dashboard/dashboard";
import type { DB } from "@/db";
import { driveConnection, spaceStorage, spaceVisits } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { createProject } from "@/lib/projects/service";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { FOLDERS, NOW, PROJECTS, RECENT_IDS, fakeActions } from "../helpers/dashboard";
import { render } from "../helpers/dom";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}
class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }),
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  notFound: () => {
    throw new NotFound();
  },
  unstable_rethrow: () => {},
}));
const { Dashboard, Shell, signedIn } = vi.hoisted(() => ({
  Dashboard: vi.fn<(props: unknown) => null>(() => null),
  Shell: vi.fn<(props: unknown) => null>(() => null),
  signedIn: { user: null as CurrentUser | null },
}));
vi.mock("@/components/dashboard/dashboard", () => ({ Dashboard }));
vi.mock("@/components/editor/editor-shell", () => ({ EditorShell: Shell }));
vi.mock("@/components/keep-signed-in", () => ({ KeepSignedIn: () => null }));
vi.mock("@/components/record-open", () => ({ RecordOpen: () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/app/(dashboard)/dashboard/actions", () => ({
  createProjectAction: vi.fn(), renameProjectAction: vi.fn(), deleteProjectAction: vi.fn(), duplicateProjectAction: vi.fn(),
  moveProjectAction: vi.fn(), createFolderAction: vi.fn(), renameFolderAction: vi.fn(), deleteFolderAction: vi.fn(),
}));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));

const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };
const bea: CurrentUser = { id: "u2", email: "bea@gmail.com", name: "Bea", image: null, allowlistRole: "editor" };
const outsider: CurrentUser = { id: "u3", email: "o@gmail.com", name: "Out", image: null, allowlistRole: "viewer" };
const inPersonal = (person: CurrentUser) => testActor({ userId: person.id, email: person.email, role: "admin", spaceId: personalSpaceId(person.id) });
const inTeam = (person: CurrentUser) => testActor({ userId: person.id, email: person.email, role: "editor" });

let teamProject: string;
let personalProject: string;
let beaProject: string;

beforeEach(async () => {
  testDb = await makeTestDb();
  for (const person of [ada, bea, outsider]) await joinSpace(testDb, person, "editor", personalSpaceId(person.id));
  for (const person of [ada, bea]) await joinSpace(testDb, person, "editor");
  teamProject = (await createProject(testDb, inTeam(ada), { name: "Team cut", format: "short_9x16" })).id;
  personalProject = (await createProject(testDb, inPersonal(ada), { name: "My own", format: "short_9x16" })).id;
  beaProject = (await createProject(testDb, inPersonal(bea), { name: "Bea's", format: "short_9x16" })).id;
  Dashboard.mockClear();
  Shell.mockClear();
});

async function dashboardAt(person: CurrentUser, slug: string, searchParams: Record<string, string> = {}): Promise<DashboardProps & { spaceSlug: string }> {
  signedIn.user = person;
  Dashboard.mockClear();
  const { unmount } = render(await SpacePage({ params: Promise.resolve({ space: slug }), searchParams: Promise.resolve(searchParams) } as never));
  unmount();
  return Dashboard.mock.calls[0][0] as DashboardProps & { spaceSlug: string };
}

async function editorAt(person: CurrentUser, slug: string, id: string) {
  signedIn.user = person;
  Shell.mockClear();
  const { unmount } = render(await EditorPage({ params: Promise.resolve({ space: slug, id }) } as never));
  unmount();
  return Shell.mock.calls[0][0] as { initial: { projectId: string }; space: { id: string; slug: string; storageReady: boolean; storageProblem: "none" | "broken" | null; kind: string; isAdmin: boolean; storageBlock: string | null; ownsConnection: boolean; ownerEmail: string | null } };
}

describe("the space dashboard", () => {
  it("shows only that space's projects and remembers the space", async () => {
    const team = await dashboardAt(ada, "seattle-solvers");
    expect(team.projects.map((p) => p.id)).toEqual([teamProject]);
    expect(team.spaceSlug).toBe("seattle-solvers");
    const mine = await dashboardAt(ada, "personal");
    expect(mine.projects.map((p) => p.id)).toEqual([personalProject]);
    expect(mine.spaceSlug).toBe("personal");
    const rows = await testDb.select().from(spaceVisits).where(eq(spaceVisits.userId, "u1"));
    expect(rows.map((r) => r.spaceId)).toEqual([personalSpaceId("u1")]);
  });

  it("binds each action to the space", async () => {
    const { createProjectAction } = await import("@/app/(dashboard)/dashboard/actions");
    const props = await dashboardAt(ada, "personal");
    await (props.actions.create as (...a: unknown[]) => unknown)("arg");
    expect(vi.mocked(createProjectAction)).toHaveBeenCalledWith(personalSpaceId("u1"), "arg");
  });

  it("a space you are not in is not found, and so is someone else's personal space", async () => {
    await expect(dashboardAt(outsider, "seattle-solvers")).rejects.toBeInstanceOf(NotFound);
    await expect(dashboardAt(ada, personalSpaceId("u2"))).rejects.toBeInstanceOf(NotFound);
    await expect(dashboardAt(ada, "no-such-space")).rejects.toBeInstanceOf(NotFound);
    expect(await testDb.select().from(spaceVisits).where(eq(spaceVisits.userId, "u3"))).toEqual([]);
  });
});

describe("the space editor", () => {
  it("opens a project of the space, with the space's slug and storage state", async () => {
    const props = await editorAt(ada, "seattle-solvers", teamProject);
    expect(props.initial.projectId).toBe(teamProject);
    expect(props.space).toMatchObject({ id: SEED_TEAM_ID, slug: "seattle-solvers", storageReady: expect.any(Boolean) });
    expect((await editorAt(ada, "personal", personalProject)).space).toMatchObject({ id: personalSpaceId("u1"), slug: "personal" });
  });

  it("says Seattle Solvers has storage even when its Drive is not set up, and a personal space has none", async () => {
    // A key that is not base64: the Media tab shows the not-set-up message from its list, not "Storage comes next".
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", '{"type":"service_account"}');
    vi.stubEnv("DRIVE_FOLDER_ID", "folder1");
    try {
      expect((await editorAt(ada, "seattle-solvers", teamProject)).space).toMatchObject({ storageReady: true, storageProblem: null });
      expect((await editorAt(ada, "personal", personalProject)).space).toMatchObject({ storageReady: false, storageProblem: "none" });
      // And with no key at all.
      vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", "");
      delete (globalThis as { __easyEditDrive?: unknown }).__easyEditDrive;
      expect((await editorAt(ada, "seattle-solvers", teamProject)).space).toMatchObject({ storageReady: true, storageProblem: null });
      // With its settings there, it is ready and nothing is wrong.
      const key = { type: "service_account", client_email: "media@easyedit-test.iam.gserviceaccount.com", private_key: "k" };
      vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", Buffer.from(JSON.stringify(key)).toString("base64"));
      delete (globalThis as { __easyEditDrive?: unknown }).__easyEditDrive;
      expect((await editorAt(ada, "seattle-solvers", teamProject)).space).toMatchObject({ storageReady: true, storageProblem: null });
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      delete (globalThis as { __easyEditDrive?: unknown }).__easyEditDrive;
    }
  });

  it("says a space's Drive is broken when its Google connection is, and ready once it isn't", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-1");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "shh");
    vi.stubEnv("STORAGE_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("BETTER_AUTH_URL", "https://app.test");
    try {
      await testDb.insert(driveConnection).values({ id: "dc_1", userId: "u1", googleSub: "g1", email: "ada.drive@gmail.com", refreshTokenEnc: "sealed", scopes: "drive.file", brokenAt: new Date(), brokenReason: "revoked" });
      await testDb.insert(spaceStorage).values({ spaceId: personalSpaceId("u1"), kind: "google_account", connectionId: "dc_1", rootFolderId: "root1", folderName: "EasyEdit – Personal", createdBy: "u1" });
      expect((await editorAt(ada, "personal", personalProject)).space).toMatchObject({ storageReady: false, storageProblem: "broken" });
      expect((await editorAt(ada, "personal", personalProject)).space).toMatchObject({ ownsConnection: true, ownerEmail: "ada@gmail.com" });
      await testDb.update(driveConnection).set({ brokenAt: null, brokenReason: null }).where(eq(driveConnection.id, "dc_1"));
      expect((await editorAt(ada, "personal", personalProject)).space).toMatchObject({ storageReady: true, storageProblem: null });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("tells the Media tab the space's kind, whether the person runs it, and what stops setting storage up here", async () => {
    vi.stubEnv("STORAGE_TOKEN_KEY", "");
    try {
      expect((await editorAt(ada, "personal", personalProject)).space).toMatchObject({ kind: "personal", isAdmin: true, storageBlock: "server" });
      expect((await editorAt(ada, "seattle-solvers", teamProject)).space).toMatchObject({ kind: "team", isAdmin: false, storageBlock: null }); // it has storage
      vi.stubEnv("GOOGLE_CLIENT_ID", "client-1");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "shh");
      vi.stubEnv("STORAGE_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64"));
      vi.stubEnv("BETTER_AUTH_URL", "https://app.test");
      expect((await editorAt(ada, "personal", personalProject)).space).toMatchObject({ storageBlock: null });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a project in another space of yours redirects to that space", async () => {
    await expect(editorAt(ada, "personal", teamProject)).rejects.toMatchObject({ to: `/s/seattle-solvers/editor/${teamProject}` });
    await expect(editorAt(ada, "seattle-solvers", personalProject)).rejects.toMatchObject({ to: `/s/personal/editor/${personalProject}` });
  });

  it("a project you cannot reach, or a space you are not in, is not found", async () => {
    await expect(editorAt(ada, "personal", beaProject)).rejects.toBeInstanceOf(NotFound);
    await expect(editorAt(outsider, "seattle-solvers", teamProject)).rejects.toBeInstanceOf(NotFound);
    await expect(editorAt(ada, "seattle-solvers", "nope")).rejects.toBeInstanceOf(NotFound);
  });
});

describe("links inside the space", () => {
  it("project cards and folder links point inside the space", async () => {
    const { Dashboard: Real } = await vi.importActual<typeof import("@/components/dashboard/dashboard")>("@/components/dashboard/dashboard");
    const { container } = render(
      <Real projects={PROJECTS} folders={FOLDERS} recentIds={RECENT_IDS} view={{ kind: "all" }} canEdit now={NOW} actions={fakeActions()} spaceSlug="seattle-solvers" />,
    );
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/s/seattle-solvers/editor/a");
    expect(hrefs).toContain("/s/seattle-solvers?folder=f1");
    expect(hrefs).toContain("/s/seattle-solvers?view=recent");
    expect(hrefs.filter((h) => h?.startsWith("/dashboard") || h?.startsWith("/editor"))).toEqual([]);
  });
});
