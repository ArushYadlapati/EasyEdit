// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { metadata as frameMetadata } from "@/app/(dashboard)/layout";
import { generateMetadata as spaceTitle } from "@/app/(dashboard)/s/[space]/page";
import { generateMetadata as settingsTitle } from "@/app/(dashboard)/s/[space]/settings/layout";
import { metadata as membersMetadata } from "@/app/(dashboard)/s/[space]/settings/members/page";
import { metadata as storageMetadata } from "@/app/(dashboard)/s/[space]/settings/storage/page";
import { metadata as brandMetadata } from "@/app/(dashboard)/s/[space]/settings/brand/page";
import { metadata as styleMetadata } from "@/app/(dashboard)/s/[space]/settings/style/page";
import { metadata as templatesMetadata } from "@/app/(dashboard)/s/[space]/settings/templates/page";
import { metadata as socialsMetadata } from "@/app/(dashboard)/s/[space]/settings/socials/page";
import { generateMetadata as editorTitle } from "@/app/(editor)/s/[space]/editor/[id]/page";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { createFolder } from "@/lib/projects/folders";
import { createProject, deleteProject } from "@/lib/projects/service";
import { SEED_TEAM_SLUG, personalSpaceId } from "@/lib/spaces/types";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const signedIn = vi.hoisted(() => ({ user: null as CurrentUser | null }));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));
// The editor page's own imports, which its title doesn't use.
vi.mock("@/components/editor/editor-shell", () => ({ EditorShell: () => null }));

const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };
const vic: CurrentUser = { id: "u2", email: "vic@gmail.com", name: "Vic", image: null, allowlistRole: "editor" };
const as = (spaceId?: string) => testActor({ userId: ada.id, email: ada.email, role: "editor", ...(spaceId ? { spaceId } : {}) });

const props = (space: string, search: Record<string, string> = {}, id?: string) =>
  ({ params: Promise.resolve({ space, ...(id ? { id } : {}) }), searchParams: Promise.resolve(search) }) as never;

beforeEach(async () => {
  testDb = await makeTestDb();
  signedIn.user = ada;
  await joinSpace(testDb, ada, "editor");
  await joinSpace(testDb, ada, "admin", personalSpaceId(ada.id));
});

describe("browser tab titles", () => {
  it("every dashboard page adds the product after its own name", () => {
    expect(frameMetadata.title).toEqual({ template: "%s · EasyEdit", default: "EasyEdit" });
  });

  it("a space's projects page names the view and the space", async () => {
    expect((await spaceTitle(props(SEED_TEAM_SLUG))).title).toBe("Seattle Solvers");
    expect((await spaceTitle(props(SEED_TEAM_SLUG, { view: "recent" }))).title).toBe("Recent · Seattle Solvers");
    expect((await spaceTitle(props(SEED_TEAM_SLUG, { view: "all" }))).title).toBe("All projects · Seattle Solvers");
    const folder = await createFolder(testDb, as(), "Season 2026");
    expect((await spaceTitle(props(SEED_TEAM_SLUG, { folder: folder.id }))).title).toBe("Season 2026 · Seattle Solvers");
    expect((await spaceTitle(props(SEED_TEAM_SLUG, { folder: "nope" }))).title).toBe("Seattle Solvers");
    expect((await spaceTitle(props("personal", { view: "all" }))).title).toBe("All projects · Personal");
  });

  it("says nothing of a space the person isn't in", async () => {
    signedIn.user = vic;
    expect(await spaceTitle(props(SEED_TEAM_SLUG))).toEqual({});
    expect(await settingsTitle(props(SEED_TEAM_SLUG))).toEqual({});
  });

  it("each settings tab names itself, then the space and the product", async () => {
    expect((await settingsTitle(props(SEED_TEAM_SLUG))).title).toEqual({
      template: "%s · Seattle Solvers · EasyEdit",
      default: "Settings · Seattle Solvers · EasyEdit",
    });
    expect((await settingsTitle(props("personal"))).title).toEqual({ template: "%s · Personal · EasyEdit", default: "Settings · Personal · EasyEdit" });
    expect([membersMetadata, storageMetadata, brandMetadata, styleMetadata, templatesMetadata, socialsMetadata].map((m) => m.title)).toEqual([
      "Members",
      "Storage",
      "Brand kit",
      "Style",
      "Templates",
      "Socials",
    ]);
  });

  it("the editor names the project, only for a member, and not once it is deleted", async () => {
    const project = await createProject(testDb, as(), { name: "Summer trip", format: "short_9x16" });
    expect((await editorTitle(props(SEED_TEAM_SLUG, {}, project.id))).title).toBe("Summer trip · EasyEdit");
    // The wrong space in the address, or someone not in it: the plain title.
    expect(await editorTitle(props("personal", {}, project.id))).toEqual({});
    signedIn.user = vic;
    expect(await editorTitle(props(SEED_TEAM_SLUG, {}, project.id))).toEqual({});
    signedIn.user = ada;
    await deleteProject(testDb, as(), project.id);
    expect(await editorTitle(props(SEED_TEAM_SLUG, {}, project.id))).toEqual({});
  });
});
