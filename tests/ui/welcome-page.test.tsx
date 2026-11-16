// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { fireEvent, render, screen } from "../helpers/dom";

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

afterEach(() => void vi.unstubAllEnvs());

describe("the welcome page", () => {
  it("hides the step label when there is one step", async () => {
    await show({ step: "agents", team: "" });
    storage.block = "server";
    document.body.innerHTML = "";
    await show();
    expect(screen.queryByText(/^Step \d+ of/)).toBeNull();
  });

  it("points the access token hints at the agents page", async () => {
    await show({ step: "agents" });
    fireEvent.click(screen.getAllByRole("tab")[2]);
    const links = screen.getAllByRole("link", { name: /access tokens/i });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.getAttribute("href")).toBe("/agents#access-tokens");
  });

  it("starts with storage when it can be set up, with the exact copy and buttons", async () => {
    await show();
    expect(screen.getByRole("heading", { name: "Welcome to EasyEdit" })).toBeTruthy();
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
    expect(screen.getByText("Where should your videos live?")).toBeTruthy();
    expect(screen.getByText("EasyEdit keeps your videos in your own Google Drive, in a folder of its own. It can't see your other files.")).toBeTruthy();
    expect(screen.getByText(/Each Google account can store videos for only one space/)).toBeTruthy();
    expect(screen.getByText("You're signed in as ada@gmail.com.")).toBeTruthy();
    const here = screen.getByRole("link", { name: "Connect to this Google Drive" });
    expect(here.getAttribute("href")).toBe(connectHref(personalSpaceId(ada.id), { signedInAccount: true, returnTo: "/welcome?step=storage" }));
    const other = screen.getByRole("link", { name: "Choose a different Google account" });
    expect(other.getAttribute("href")).toBe(connectHref(personalSpaceId(ada.id), { returnTo: "/welcome?step=storage" }));
    expect(screen.queryByRole("link", { name: "Choose Google account" })).toBeNull();
    expect(screen.getByRole("link", { name: "Skip for now" }).getAttribute("href")).toBe("/welcome?step=agents");
    expect(screen.getByRole("button", { name: "Skip setup" })).toBeTruthy();
  });

  it("goes straight to the agents step when storage is blocked or already set up", async () => {
    for (const setup of [() => (storage.block = "server"), () => (storage.ready = true)]) {
      storage.block = null;
      storage.ready = false;
      setup();
      await show();
      expect(screen.queryByText(/^Step \d+ of/)).toBeNull();
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

  it("after a connect, shows that it worked and waits for Continue", async () => {
    storage.ready = true; // the connect just gave Personal its storage
    await show({ step: "storage", storage: "connected" });
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Google Drive connected.");
    expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe("/welcome?step=agents");
    expect(screen.queryByRole("link", { name: "Connect to this Google Drive" })).toBeNull();
    expect(screen.queryByText("Use EasyEdit with your AI agent")).toBeNull();
  });

  it("a connected note with no storage behind it shows the normal storage step", async () => {
    await show({ step: "storage", storage: "connected" });
    expect(screen.queryByText("Google Drive connected.")).toBeNull();
    expect(screen.getByRole("link", { name: "Connect to this Google Drive" })).toBeTruthy();
  });

  it("after a connect that didn't work, says why and offers the choices again", async () => {
    await show({ step: "storage", storage: "account-in-use" });
    expect(screen.getByRole("alert").textContent).toBe(
      "That Google account already holds another EasyEdit space's storage. Choose a different Google account.",
    );
    expect(screen.getByRole("link", { name: "Connect to this Google Drive" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Choose a different Google account" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skip for now" }).getAttribute("href")).toBe("/welcome?step=agents");
  });

  it("ignores a storage note it doesn't know", async () => {
    await show({ step: "storage", storage: "<b>hi</b>" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("an unknown step is the first step", async () => {
    await show({ step: "nonsense" });
    expect(screen.getByText("Where should your videos live?")).toBeTruthy();
  });

  it("an invited member of the team sees the agents step only", async () => {
    await joinSpace(testDb, ada, "editor");
    await show({ team: SEED_TEAM_SLUG });
    expect(screen.queryByText(/^Step \d+ of/)).toBeNull();
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

  it("lands in the team, not the closed Personal space, while Personal spaces are off", async () => {
    vi.stubEnv("PERSONAL_SPACES", "");
    await joinSpace(testDb, ada, "editor");
    expect(await redirectOf(() => finishOnboardingAction(form()))).toBe(`/s/${SEED_TEAM_SLUG}`);
  });

  it("still redirects when the mark can't be written", async () => {
    await testDb.execute((await import("drizzle-orm")).sql`drop table onboarding`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await redirectOf(() => finishOnboardingAction(form()))).toBe("/s/personal");
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
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

  it("an account that has not onboarded keeps ?storage=, ?passkeys= and ?folder= instead of being bounced", async () => {
    expect(await dashboard({ storage: "failed" })).toBe("/s/personal?storage=failed");
    expect(await dashboard({ storage: "refused" })).toBe("/s/personal?storage=refused");
    expect(await dashboard({ passkeys: "1" })).toBe("/s/personal?passkeys=1");
    expect(await dashboard({ folder: "nope" })).toBe("/s/personal?folder=nope");
  });

  it("an unrelated query does not skip the welcome", async () => {
    expect(await dashboard({ utm: "x" })).toBe("/welcome");
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
