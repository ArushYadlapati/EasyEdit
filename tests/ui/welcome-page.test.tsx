// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import WelcomePage from "@/app/(dashboard)/welcome/page";
import { finishOnboardingAction } from "@/app/(dashboard)/welcome/actions";
import DashboardRedirect from "@/app/(dashboard)/dashboard/page";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { hasOnboarded, markOnboarded } from "@/lib/onboarding/state";
import { connectHref } from "@/lib/storage/messages";
import { personalSpaceId, SEED_TEAM_SLUG } from "@/lib/spaces/types";
import { joinSpace } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { render, screen } from "../helpers/dom";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/welcome",
}));
const signedIn = vi.hoisted(() => ({ user: null as CurrentUser | null }));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
const storage = vi.hoisted(() => ({ block: null as null | "server", ready: false }));
vi.mock("@/lib/storage/availability", () => ({ storageBlock: () => storage.block }));
vi.mock("@/lib/spaces/storage", async (orig) => ({
  ...(await orig<typeof import("@/lib/spaces/storage")>()),
  storageState: async () => (storage.ready ? { ready: true } : { ready: false, reason: "none" }),
}));
vi.mock("@/lib/connector/config", async (orig) => ({ ...(await orig<typeof import("@/lib/connector/config")>()), mcpResourceUrl: () => "https://easyedit.test/api/mcp" }));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));

const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };

beforeEach(async () => {
  testDb = await makeTestDb();
  signedIn.user = ada;
  storage.block = null;
  storage.ready = false;
  await joinSpace(testDb, ada, "editor", personalSpaceId(ada.id));
});

async function show(search: Record<string, string> = {}) {
  render(await WelcomePage({ params: Promise.resolve({}), searchParams: Promise.resolve(search) } as never));
}
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
  throw new Error("no redirect");
}

describe("the welcome page", () => {
  it("starts with storage when it can be set up, with the exact copy and buttons", async () => {
    await show();
    expect(screen.getByRole("heading", { name: "Welcome to EasyEdit" })).toBeTruthy();
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
    expect(screen.getByText("Where should your videos live?")).toBeTruthy();
    expect(screen.getByText("EasyEdit keeps your videos in your own Google Drive, in a folder of its own. It can't see your other files.")).toBeTruthy();
    expect(screen.getByText(/Each Google account can store videos for only one space/)).toBeTruthy();
    const choose = screen.getByRole("link", { name: "Choose Google account" });
    expect(choose.getAttribute("href")).toBe(connectHref(personalSpaceId(ada.id), undefined, "/welcome?step=agents"));
    expect(screen.getByRole("link", { name: "Skip for now" }).getAttribute("href")).toBe("/welcome?step=agents");
    expect(screen.getByRole("button", { name: "Skip setup" })).toBeTruthy();
  });

  it("goes straight to the agents step when storage is blocked or already set up", async () => {
    for (const setup of [() => (storage.block = "server"), () => (storage.ready = true)]) {
      storage.block = null;
      storage.ready = false;
      setup();
      await show();
      expect(screen.getByText("Step 1 of 1")).toBeTruthy();
      expect(screen.getByText("Use EasyEdit with your AI agent")).toBeTruthy();
      expect(screen.queryByText("Where should your videos live?")).toBeNull();
      document.body.innerHTML = "";
    }
  });

  it("shows the agents step with Finish and Skip, and the agent picker", async () => {
    await show({ step: "agents" });
    expect(screen.getByText("Step 2 of 2")).toBeTruthy();
    expect(screen.getByText("Connect Claude, ChatGPT or another agent to make and edit videos by asking. You can do this any time from AI agents in your account menu.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip setup" })).toBeTruthy();
    expect(screen.getAllByRole("tab").length).toBeGreaterThan(1);
  });

  it("an unknown step is the first step", async () => {
    await show({ step: "nonsense" });
    expect(screen.getByText("Where should your videos live?")).toBeTruthy();
  });

  it("an invited member of the team sees the agents step only", async () => {
    await joinSpace(testDb, ada, "editor");
    await show({ team: SEED_TEAM_SLUG });
    expect(screen.getByText("Step 1 of 1")).toBeTruthy();
    expect(screen.getByText("Use EasyEdit with your AI agent")).toBeTruthy();
  });

  it("a team that isn't the person's is ignored: the normal flow", async () => {
    await show({ team: SEED_TEAM_SLUG });
    expect(screen.getByText("Where should your videos live?")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skip for now" }).getAttribute("href")).toBe("/welcome?step=agents");
  });

  it("never redirects to /dashboard", async () => {
    await markOnboarded(testDb, ada.id);
    await show(); // an onboarded account still sees it
    expect(screen.getByText("Welcome to EasyEdit")).toBeTruthy();
  });
});

describe("finishing", () => {
  const form = (team?: string) => {
    const f = new FormData();
    if (team) f.set("team", team);
    return f;
  };

  it("marks the account done and lands in the personal space", async () => {
    expect(await redirectOf(() => finishOnboardingAction(form()))).toBe("/s/personal");
    expect(await hasOnboarded(testDb, ada.id)).toBe(true);
  });

  it("lands in the team named, when the person is in it", async () => {
    await joinSpace(testDb, ada, "editor");
    expect(await redirectOf(() => finishOnboardingAction(form(SEED_TEAM_SLUG)))).toBe(`/s/${SEED_TEAM_SLUG}`);
    expect(await hasOnboarded(testDb, ada.id)).toBe(true);
  });

  it("ignores a team the person isn't in", async () => {
    expect(await redirectOf(() => finishOnboardingAction(form(SEED_TEAM_SLUG)))).toBe("/s/personal");
    expect(await redirectOf(() => finishOnboardingAction(form("no-such-team")))).toBe("/s/personal");
  });

  it("finishing twice is fine", async () => {
    await redirectOf(() => finishOnboardingAction(form()));
    expect(await redirectOf(() => finishOnboardingAction(form()))).toBe("/s/personal");
  });
});

describe("/dashboard and onboarding", () => {
  const dashboard = (q: Record<string, string> = {}) =>
    redirectOf(() => DashboardRedirect({ params: Promise.resolve({}), searchParams: Promise.resolve(q) } as never));

  it("sends an account that has not onboarded to /welcome", async () => {
    expect(await dashboard()).toBe("/welcome");
  });

  it("sends an onboarded account straight to its space, with its query", async () => {
    await markOnboarded(testDb, ada.id);
    expect(await dashboard({ passkeys: "1" })).toBe("/s/personal?passkeys=1");
  });

  it("a read error counts as onboarded", async () => {
    await testDb.execute((await import("drizzle-orm")).sql`drop table onboarding`);
    expect(await dashboard()).toBe("/s/personal");
  });
});
