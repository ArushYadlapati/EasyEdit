// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardRedirect from "@/app/(dashboard)/dashboard/page";
import DashboardLayout from "@/app/(dashboard)/layout";
import SpacePage from "@/app/(dashboard)/s/[space]/page";
import SettingsLayout from "@/app/(dashboard)/s/[space]/settings/layout";
import SettingsIndex from "@/app/(dashboard)/s/[space]/settings/page";
import StoragePage from "@/app/(dashboard)/s/[space]/settings/storage/page";
import { PersonalSoon } from "@/components/dashboard/personal-soon";
import { SpaceSwitcher, SpacesProvider, usePersonalSoon } from "@/components/dashboard/space-switcher";
import type { DB } from "@/db";
import { spaceVisits } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { createProject } from "@/lib/projects/service";
import { listMySpaces, rememberSpace } from "@/lib/spaces/service";
import { personalSpaceId, SEED_TEAM_ID, type MySpace } from "@/lib/spaces/types";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { render, screen } from "../helpers/dom";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}
class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }),
  usePathname: () => "/s/personal",
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  notFound: () => {
    throw new NotFound();
  },
  unstable_rethrow: () => {},
}));
const { Dashboard, signedIn } = vi.hoisted(() => ({
  Dashboard: vi.fn<(props: unknown) => null>(() => null),
  signedIn: { user: null as CurrentUser | null },
}));
vi.mock("@/components/dashboard/dashboard", () => ({ Dashboard }));
vi.mock("@/components/keep-signed-in", () => ({ KeepSignedIn: () => null }));
vi.mock("@/app/(dashboard)/dashboard/actions", () => ({
  createProjectAction: vi.fn(), renameProjectAction: vi.fn(), deleteProjectAction: vi.fn(), duplicateProjectAction: vi.fn(),
  moveProjectAction: vi.fn(), pinProjectAction: vi.fn(), unpinProjectAction: vi.fn(), createFolderAction: vi.fn(), renameFolderAction: vi.fn(), deleteFolderAction: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/app/(dashboard)/s/new/actions", () => ({ createTeamAction: vi.fn() }));
vi.mock("@/app/(dashboard)/s/[space]/settings/storage/actions", () => ({ chooseConnectionAction: vi.fn() }));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));

const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };
const solo: CurrentUser = { id: "u9", email: "solo@gmail.com", name: "Solo", image: null, allowlistRole: null };
const inPersonal = (person: CurrentUser) => testActor({ userId: person.id, email: person.email, role: "admin", spaceId: personalSpaceId(person.id) });

beforeEach(async () => {
  vi.stubEnv("PERSONAL_SPACES", "");
  Dashboard.mockClear();
  testDb = await makeTestDb();
  await joinSpace(testDb, ada, "admin", personalSpaceId(ada.id));
  await joinSpace(testDb, ada, "editor");
  await joinSpace(testDb, solo, "admin", personalSpaceId(solo.id));
});
afterEach(() => void vi.unstubAllEnvs());

async function target(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    if (e instanceof NotFound) return "notFound";
    throw e;
  }
  return "rendered";
}

// A space's page as this person sees it, inside the spaces the dashboard layout hands down.
async function spacePage(person: CurrentUser, space: string) {
  signedIn.user = person;
  const spaces = await listMySpaces(testDb, person.id);
  const page = await SpacePage({ params: Promise.resolve({ space }), searchParams: Promise.resolve({}) } as never);
  return render(
    <SpacesProvider spaces={spaces} personalSoon>
      {page}
    </SpacesProvider>,
  );
}

describe("a personal space while personal spaces are not offered", () => {
  it("says it is coming soon and leads to the person's team, with no dashboard", async () => {
    await spacePage(ada, "personal");
    expect(Dashboard).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Personal spaces are coming soon" })).toBeTruthy();
    expect(screen.getByText(/For now, EasyEdit is for teams\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Seattle Solvers" }).getAttribute("href")).toBe("/s/seattle-solvers");
    expect(screen.queryByText("Projects you already made here")).toBeNull();
  });

  it("is not remembered, so the dashboard's old address keeps leading to the team", async () => {
    await spacePage(ada, "personal");
    expect(await testDb.select().from(spaceVisits)).toHaveLength(0);
    signedIn.user = ada;
    expect(await target(() => DashboardRedirect({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never))).toBe("/s/seattle-solvers");
  });

  it("the dashboard's old address passes over a personal space remembered before", async () => {
    await rememberSpace(testDb, ada.id, personalSpaceId(ada.id));
    signedIn.user = ada;
    expect(await target(() => DashboardRedirect({ params: Promise.resolve({}), searchParams: Promise.resolve({ passkeys: "1" }) } as never))).toBe(
      "/s/seattle-solvers?passkeys=1",
    );
  });

  it("lists what the person already made there, each opening in the editor", async () => {
    const made = await createProject(testDb, inPersonal(ada), { name: "My own cut", format: "short_9x16" });
    await spacePage(ada, "personal");
    const section = screen.getByRole("region", { name: "Projects you already made here" });
    const link = screen.getByRole("link", { name: "My own cut" });
    expect(section.contains(link)).toBe(true);
    expect(link.getAttribute("href")).toBe(`/s/personal/editor/${made.id}`);
  });

  it("someone in no team is told so, and sent nowhere", async () => {
    await spacePage(solo, "personal");
    expect(screen.getByText("You're not in a team yet. Ask a team's admin to add you.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Go to/ })).toBeNull();
    signedIn.user = solo;
    expect(await target(() => DashboardRedirect({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never))).toBe("/s/personal");
  });

  it("shows the person's pending invites, so someone invited with no team can reach them", () => {
    const personal: MySpace = { id: "personal_u9", slug: "personal_u9", name: "Personal", kind: "personal", role: "admin" };
    render(
      <SpacesProvider spaces={[personal]} personalSoon invites={[{ id: "inv1", teamName: "Robo Club" }]}>
        <PersonalSoon projects={[]} />
      </SpacesProvider>,
    );
    expect(screen.getByRole("link", { name: "Robo Club" }).getAttribute("href")).toBe("/invite/inv1");
  });

  it("someone in no team who may make one is pointed at Create a team", () => {
    const personal: MySpace = { id: "personal_u9", slug: "personal_u9", name: "Personal", kind: "personal", role: "admin" };
    render(
      <SpacesProvider spaces={[personal]} personalSoon createTeam={vi.fn()}>
        <PersonalSoon projects={[]} />
      </SpacesProvider>,
    );
    expect(screen.getByText("You're not in a team yet. Make one with Create a team, under My Spaces.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create a team" })).toBeTruthy();
  });

  it("a team's page is the dashboard as before, and is remembered", async () => {
    await spacePage(ada, "seattle-solvers");
    expect(Dashboard).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Personal spaces are coming soon")).toBeNull();
    expect((await testDb.select().from(spaceVisits)).map((v) => v.spaceId)).toEqual([SEED_TEAM_ID]);
  });

  it("its settings lead back to the coming-soon page", async () => {
    signedIn.user = ada;
    const params = Promise.resolve({ space: "personal" });
    expect(await target(() => SettingsLayout({ params, children: null } as never))).toBe("/s/personal");
    expect(await target(() => StoragePage({ params, searchParams: Promise.resolve({}) } as never))).toBe("/s/personal");
    // The index goes to the first tab (Storage), which then leads back.
    expect(await target(() => SettingsIndex({ params } as never))).toBe("/s/personal/settings/storage");
  });

  it("the dashboard layout tells its pages that Personal is coming soon", async () => {
    signedIn.user = ada;
    const Probe = () => <p>{usePersonalSoon() ? "soon" : "open"}</p>;
    render(await DashboardLayout({ children: <Probe />, params: Promise.resolve({}) } as never));
    expect(screen.getByText("soon")).toBeTruthy();
  });
});

describe("with personal spaces switched on", () => {
  beforeEach(() => void vi.stubEnv("PERSONAL_SPACES", "true"));

  it("the personal space is a dashboard, and its settings open", async () => {
    await spacePage(ada, "personal");
    expect(Dashboard).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Personal spaces are coming soon")).toBeNull();
    signedIn.user = ada;
    expect(await target(() => StoragePage({ params: Promise.resolve({ space: "personal" }), searchParams: Promise.resolve({}) } as never))).toBe("rendered");
  });

  it("the dashboard layout says nothing is coming soon", async () => {
    signedIn.user = ada;
    const Probe = () => <p>{usePersonalSoon() ? "soon" : "open"}</p>;
    render(await DashboardLayout({ children: <Probe />, params: Promise.resolve({}) } as never));
    expect(screen.getByText("open")).toBeTruthy();
  });
});

describe("My Spaces while personal spaces are not offered", () => {
  const PERSONAL: MySpace = { id: "personal_u1", slug: "personal_u1", name: "Personal", kind: "personal", role: "admin" };
  const APEX: MySpace = { id: "team_apex", slug: "apex", name: "Apex", kind: "team", role: "admin" };
  const SOLVERS: MySpace = { id: SEED_TEAM_ID, slug: "seattle-solvers", name: "Seattle Solvers", kind: "team", role: "editor" };

  it("lists the teams first and Personal last, tagged Soon and still a link to its page", () => {
    render(<SpaceSwitcher spaces={[PERSONAL, APEX, SOLVERS]} current={SOLVERS.id} personalSoon />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/s/apex", "/s/seattle-solvers", "/s/personal"]);
    expect(links[2].textContent).toBe("Personal Soon");
    // Read aloud as one name, whatever the browser makes of the two pieces.
    expect(screen.getByRole("link", { name: "Personal, coming soon" })).toBe(links[2]);
    expect(screen.getAllByText("Soon")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Seattle Solvers" }).getAttribute("aria-current")).toBe("page");
  });

  it("without it, Personal comes first and has no tag", () => {
    render(<SpaceSwitcher spaces={[PERSONAL, APEX, SOLVERS]} current={SOLVERS.id} />);
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Personal", "Apex", "Seattle Solvers"]);
    expect(screen.queryByText("Soon")).toBeNull();
  });
});
