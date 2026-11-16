// @vitest-environment happy-dom
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsIndex from "@/app/(dashboard)/s/[space]/settings/page";
import SettingsLayout from "@/app/(dashboard)/s/[space]/settings/layout";
import MembersPage from "@/app/(dashboard)/s/[space]/settings/members/page";
import { Sidebar } from "@/components/dashboard/sidebar";
import { SpacesProvider } from "@/components/dashboard/space-switcher";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import type { Role } from "@/lib/allowlist/service";
import { personalSpaceId, SEED_TEAM_ID, type MySpace } from "@/lib/spaces/types";
import { actorIn } from "@/lib/spaces/access";
import { inviteToTeam } from "@/lib/spaces/invites";
import { joinSpace } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { render, screen, within } from "../helpers/dom";

class NotFound extends Error {}
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
const at = vi.hoisted(() => ({ path: "/s/robots/settings/members" }));
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
const { signedIn, memberActions } = vi.hoisted(() => ({
  signedIn: { user: null as CurrentUser | null },
  memberActions: {
    inviteMemberAction: vi.fn(async () => ({})),
    cancelInviteAction: vi.fn(async () => ({})),
    setMemberRoleAction: vi.fn(async () => ({})),
    removeMemberAction: vi.fn(async () => ({})),
    leaveTeamAction: vi.fn(async () => ({})),
    deleteTeamAction: vi.fn(async () => ({})),
  },
}));
vi.mock("@/app/(dashboard)/s/[space]/settings/members/actions", () => memberActions);
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));

const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: null };
const bea: CurrentUser = { id: "u2", email: "bea@gmail.com", name: "Bea", image: null, allowlistRole: null };
const out: CurrentUser = { id: "u3", email: "out@gmail.com", name: "Out", image: null, allowlistRole: null };
const root: CurrentUser = { id: "u4", email: "root@gmail.com", name: "Root", image: null, allowlistRole: "admin" };

async function membersPage(person: CurrentUser, slug: string) {
  signedIn.user = person;
  return render(await MembersPage({ params: Promise.resolve({ space: slug }) } as never));
}
async function layout(person: CurrentUser, slug: string) {
  signedIn.user = person;
  return render(await SettingsLayout({ params: Promise.resolve({ space: slug }), children: <p>inside</p> } as never));
}
async function index(person: CurrentUser, slug: string) {
  signedIn.user = person;
  return SettingsIndex({ params: Promise.resolve({ space: slug }) } as never);
}

beforeEach(async () => {
  testDb = await makeTestDb();
  for (const person of [ada, bea, out, root]) await joinSpace(testDb, person, "admin", personalSpaceId(person.id));
  await testDb.execute(sql`insert into organization (id, name, slug, created_at, kind) values ('team_robots', 'Robots', 'robots', now(), 'team')`);
  await joinSpace(testDb, ada, "admin", "team_robots");
  await joinSpace(testDb, bea, "viewer", "team_robots");
  await joinSpace(testDb, ada, "admin");
  await joinSpace(testDb, bea, "editor");
  await joinSpace(testDb, root, "admin");
  for (const action of Object.values(memberActions)) action.mockClear();
});

describe("the members page", () => {
  it("a member of the team sees its members; an admin gets the controls", async () => {
    const page = await membersPage(ada, "robots");
    expect(screen.getByRole("heading", { name: "Members" })).toBeTruthy();
    expect(screen.getByText("2 members")).toBeTruthy();
    expect(screen.getByText("ada@gmail.com")).toBeTruthy();
    expect(screen.getByText("bea@gmail.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Role for bea@gmail.com" })).toBeTruthy();
    page.unmount();

    await membersPage(bea, "robots");
    expect(screen.getByText("2 members")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
    expect(screen.queryAllByRole("combobox")).toEqual([]);
    expect(screen.getByRole("button", { name: "Leave team" })).toBeTruthy();
  });

  it("an admin sees pending invites with finished links; others and Seattle Solvers see none", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://easyedit.test");
    const invite = await inviteToTeam(testDb, (await actorIn(testDb, ada, "team_robots"))!, { email: "lin@example.com", role: "editor" });
    const page = await membersPage(ada, "robots");
    expect(screen.getByRole("heading", { name: "Pending invites" })).toBeTruthy();
    expect(screen.getByText("lin@example.com")).toBeTruthy();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    screen.getByRole("button", { name: "Copy link" }).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(`https://easyedit.test/invite/${invite.id}`));
    page.unmount();
    await membersPage(bea, "robots");
    expect(screen.queryByText("lin@example.com")).toBeNull();
    vi.unstubAllEnvs();
  });

  it("binds each action to the team", async () => {
    await membersPage(bea, "robots");
    const { leaveTeamAction } = await import("@/app/(dashboard)/s/[space]/settings/members/actions");
    screen.getByRole("button", { name: "Leave team" }).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    within(screen.getByRole("dialog", { name: "Leave Robots?" })).getByRole("button", { name: "Leave team" }).click();
    await vi.waitFor(() => expect(vi.mocked(leaveTeamAction)).toHaveBeenCalledWith("team_robots"));
  });

  it("a non-member and a personal space get not found", async () => {
    await expect(membersPage(out, "robots")).rejects.toBeInstanceOf(NotFound);
    await expect(membersPage(ada, "no-such-team")).rejects.toBeInstanceOf(NotFound);
    await expect(membersPage(ada, "personal")).rejects.toBeInstanceOf(NotFound);
    await expect(membersPage(ada, personalSpaceId("u2"))).rejects.toBeInstanceOf(NotFound);
  });

  it("Seattle Solvers shows the managed-on-Admin line and no controls", async () => {
    const page = await membersPage(ada, "seattle-solvers");
    expect(screen.getByText("3 members")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("combobox")).toEqual([]);
    const line = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Seattle Solvers' members are managed on the Admin page.");
    expect(within(line).queryByRole("link")).toBeNull();
    page.unmount();

    // For an allowlist admin, the words Admin page lead there.
    await membersPage(root, "seattle-solvers");
    expect(screen.getByRole("link", { name: "Admin page" }).getAttribute("href")).toBe("/admin");
  });
});

describe("the settings layout and tabs", () => {
  it("any member may enter; someone not in the space gets not found", async () => {
    await layout(bea, "robots");
    expect(screen.getByRole("heading", { level: 1, name: "Robots" })).toBeTruthy();
    expect(screen.getByText("inside")).toBeTruthy();
    await expect(layout(out, "robots")).rejects.toBeInstanceOf(NotFound);
    await expect(layout(ada, personalSpaceId("u2"))).rejects.toBeInstanceOf(NotFound);
  });

  it("the Storage tab is absent for a non-admin; an admin sees Members then Storage", async () => {
    at.path = "/s/robots/settings/members";
    const member = await layout(bea, "robots");
    const tabs = () => within(screen.getByRole("navigation", { name: "Settings" })).getAllByRole("link");
    expect(tabs().map((t) => t.textContent)).toEqual(["Members", "Brand kit"]);
    expect(tabs()[0]!.getAttribute("href")).toBe("/s/robots/settings/members");
    expect(tabs()[0]!.getAttribute("aria-current")).toBe("page");
    member.unmount();

    await layout(ada, "robots");
    expect(tabs().map((t) => t.textContent)).toEqual(["Members", "Storage", "Brand kit"]);
  });

  it("a personal space shows only Storage", async () => {
    at.path = "/s/personal/settings/storage";
    await layout(ada, "personal");
    const tabs = within(screen.getByRole("navigation", { name: "Settings" })).getAllByRole("link");
    expect(tabs.map((t) => t.textContent)).toEqual(["Storage", "Brand kit"]);
  });

  it("/s/<space>/settings opens the first tab the viewer may see", async () => {
    await expect(index(ada, "robots")).rejects.toMatchObject({ to: "/s/robots/settings/members" });
    await expect(index(bea, "robots")).rejects.toMatchObject({ to: "/s/robots/settings/members" });
    await expect(index(ada, "personal")).rejects.toMatchObject({ to: "/s/personal/settings/storage" });
    await expect(index(out, "robots")).rejects.toBeInstanceOf(NotFound);
  });
});

describe("the sidebar's This space", () => {
  const space = (id: string, slug: string, role: Role, kind: "personal" | "team" = "team"): MySpace => ({ id, slug, name: slug, kind, role });
  const sidebarIn = (spaces: MySpace[], spaceSlug: string) =>
    render(
      <SpacesProvider spaces={spaces}>
        <Sidebar folders={[]} view={{ kind: "recent" }} canEdit={false} spaceSlug={spaceSlug} onNewFolder={() => {}} onDropProject={() => {}} />
      </SpacesProvider>,
    );
  const links = () => within(screen.getByRole("navigation", { name: "This space" })).getAllByRole("link");

  it("every member of a team gets Members; only admins get Storage, below it", () => {
    const viewer = sidebarIn([space("team_robots", "robots", "viewer")], "robots");
    expect(links().map((l) => l.textContent)).toEqual(["Members"]);
    expect(links()[0]!.getAttribute("href")).toBe("/s/robots/settings/members");
    viewer.unmount();
    const editor = sidebarIn([space(SEED_TEAM_ID, "seattle-solvers", "editor")], "seattle-solvers");
    expect(links().map((l) => l.textContent)).toEqual(["Members"]);
    editor.unmount();
    sidebarIn([space("team_robots", "robots", "admin")], "robots");
    expect(links().map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Members", "/s/robots/settings/members"],
      ["Storage", "/s/robots/settings/storage"],
    ]);
  });

  it("a personal space has Storage only", () => {
    sidebarIn([space(personalSpaceId("u1"), personalSpaceId("u1"), "admin", "personal")], "personal");
    expect(links().map((l) => l.textContent)).toEqual(["Storage"]);
  });
});
