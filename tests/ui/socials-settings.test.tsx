// @vitest-environment happy-dom
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsLayout from "@/app/(dashboard)/s/[space]/settings/layout";
import SocialsPage from "@/app/(dashboard)/s/[space]/settings/socials/page";
import { SocialsSettings } from "@/components/socials/socials-settings";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { ServiceError } from "@/lib/service-error";
import { socialConfig } from "@/lib/social/config";
import { saveYoutubeConnection } from "@/lib/social/connections";
import { makeSocialActions } from "@/lib/social/social-actions";
import type { SocialsSettingsView } from "@/lib/social/view";
import { settingsTabsFor } from "@/lib/spaces/settings-tabs";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { joinSpace, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { fireEvent, render, screen, waitFor, within } from "../helpers/dom";

class NotFound extends Error {}
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/s/seattle-solvers/settings/socials",
  notFound: () => {
    throw new NotFound();
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  unstable_rethrow: () => {},
}));
const { signedIn } = vi.hoisted(() => ({ signedIn: { user: null as CurrentUser | null } }));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));

const SEED = { id: SEED_TEAM_ID, slug: "seattle-solvers", name: "Seattle Solvers", kind: "team" as const };
const NOW = new Date("2026-11-17T12:00:00Z");
const channel = (over: Partial<NonNullable<SocialsSettingsView["youtube"]>> = {}): SocialsSettingsView["youtube"] => ({ name: "Seattle Solvers", email: "team@gmail.com", connectedBy: "Ada", broken: false, ...over });

function show(view: Partial<SocialsSettingsView> = {}, note: string | null = null) {
  const disconnect = vi.fn(async () => ({}) as { error?: string });
  const full: SocialsSettingsView = { space: SEED, youtube: null, posts: [], postsPerDay: 10, ...view };
  render(<SocialsSettings view={full} note={note} disconnect={disconnect} now={NOW} />);
  return { disconnect };
}

function configure() {
  vi.stubEnv("YOUTUBE_CLIENT_ID", "yt-client");
  vi.stubEnv("YOUTUBE_CLIENT_SECRET", "yt-secret");
  vi.stubEnv("STORAGE_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("BETTER_AUTH_URL", "https://app.test");
}

beforeEach(() => {
  router.replace.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the Socials tab", () => {
  it("is for a space's admins, and only on a server where posting is set up", () => {
    const ids = (role: "admin" | "editor", socials?: boolean) => settingsTabsFor({ kind: "team", role }, { socials }).map((tab) => tab.id);
    expect(ids("admin", true)).toEqual(["members", "storage", "brand", "templates", "socials"]);
    expect(ids("admin", false)).not.toContain("socials");
    expect(ids("admin")).not.toContain("socials");
    expect(ids("editor", true)).not.toContain("socials");
    expect(settingsTabsFor({ kind: "personal", role: "admin" }, { socials: true }).map((tab) => tab.id)).toEqual(["storage", "brand", "templates", "socials"]);
  });

  it("shows in the settings tab row once the server has its YouTube settings", async () => {
    testDb = await makeTestDb();
    await joinSpace(testDb, { id: "u1" }, "admin");
    signedIn.user = testUser({ id: "u1" });
    const layout = () => SettingsLayout({ params: Promise.resolve({ space: "seattle-solvers" }), children: null });
    const first = render(await layout());
    expect(screen.queryByRole("link", { name: "Socials" })).toBeNull();
    first.unmount();
    configure();
    render(await layout());
    expect(screen.getByRole("link", { name: "Socials" }).getAttribute("href")).toBe("/s/seattle-solvers/settings/socials");
  });
});

describe("the Socials settings page", () => {
  const page = (space = "seattle-solvers", youtube?: string) => SocialsPage({ params: Promise.resolve({ space }), searchParams: Promise.resolve(youtube ? { youtube } : {}) });

  it("is not there for anyone but the space's admin, or on a server without posting", async () => {
    testDb = await makeTestDb();
    await joinSpace(testDb, { id: "u1" }, "admin");
    await joinSpace(testDb, { id: "u2" }, "editor");
    signedIn.user = testUser({ id: "u1" });
    await expect(page()).rejects.toBeInstanceOf(NotFound); // no settings
    configure();
    signedIn.user = testUser({ id: "u2" });
    await expect(page()).rejects.toBeInstanceOf(NotFound);
    signedIn.user = testUser({ id: "u1" });
    await expect(page("nowhere")).rejects.toBeInstanceOf(NotFound);
  });

  it("shows the space's channel and what connecting came back with", async () => {
    testDb = await makeTestDb();
    await joinSpace(testDb, { id: "u1", name: "Ada" }, "admin");
    signedIn.user = testUser({ id: "u1" });
    configure();
    await saveYoutubeConnection(testDb, socialConfig()!, { spaceId: SEED_TEAM_ID, connectedBy: "u1", googleSub: "g1", email: "team@gmail.com", channel: { id: "UC1", title: "Seattle Solvers" }, refreshToken: "r", scopes: [] });
    render(await page("seattle-solvers", "connected"));
    expect(screen.getByRole("status").textContent).toBe("YouTube channel connected.");
    expect(screen.getByText("Seattle Solvers").closest("p")?.textContent).toBe("Posting to Seattle Solvers");
    expect(screen.getByText("Google account: team@gmail.com")).toBeTruthy();
    expect(screen.getByText("Connected by Ada. If they leave this team, the channel is disconnected.")).toBeTruthy();
  });
});

describe("SocialsSettings", () => {
  it("with no channel: says what connecting does and links to the connect route", () => {
    show();
    const link = screen.getByRole("link", { name: "Connect a YouTube channel" });
    expect(link.getAttribute("href")).toBe(`/api/social/youtube/connect?space=${SEED_TEAM_ID}`);
    expect(screen.getByText(/Nothing is posted until someone presses Post\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recent posts" })).toBeNull();
  });

  it("with a channel: names it, and offers another channel and Disconnect", () => {
    show({ youtube: channel() });
    expect(screen.getByRole("link", { name: "Use a different channel" }).getAttribute("href")).toBe(`/api/social/youtube/connect?space=${SEED_TEAM_ID}`);
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(screen.getByText("Nothing has been posted from this space yet.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Connected by Ada. If they leave this team, the channel is disconnected.")).toBeTruthy();
  });

  it("a personal space's channel has nobody to leave", () => {
    show({ space: { id: "personal_u1", slug: "personal", name: "Personal", kind: "personal" }, youtube: channel() });
    expect(screen.getByText("Connected by Ada")).toBeTruthy();
  });

  it("shows the Google address alone when the channel's name is not known", () => {
    show({ youtube: channel({ name: "team@gmail.com", email: null, connectedBy: null }) });
    expect(screen.getByText("team@gmail.com").closest("p")?.textContent).toBe("Posting to team@gmail.com");
    expect(screen.queryByText(/Google account:/)).toBeNull();
    expect(screen.queryByText(/Connected by/)).toBeNull();
  });

  it("a broken connection says so and leads with Connect again", () => {
    show({ youtube: channel({ broken: true }) });
    expect(screen.getByRole("alert").textContent).toBe("EasyEdit lost its connection to this channel. Connect it again to keep posting.");
    expect(screen.getByRole("link", { name: "Connect again" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Use a different channel" })).toBeNull();
  });

  it("says what a connect came back with, a problem as an alert, and nothing for a note it does not know", () => {
    const first = render(<SocialsSettings view={{ space: SEED, youtube: null, posts: [], postsPerDay: 10 }} note="no-channel" disconnect={async () => ({})} />);
    expect(screen.getByRole("alert").textContent).toMatch(/has no YouTube channel yet/);
    first.unmount();
    show({}, "<script>");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Disconnect asks first, then goes back to the page with a note", async () => {
    const { disconnect } = show({ youtube: channel() });
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Disconnect Seattle Solvers?")).toBeTruthy();
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/s/seattle-solvers/settings/socials?youtube=disconnected"));
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("a refused disconnect stays in the dialog with the reason", async () => {
    const disconnect = vi.fn(async () => ({ error: "Disconnecting didn't work. Try again." }));
    render(<SocialsSettings view={{ space: SEED, youtube: channel(), posts: [], postsPerDay: 10 }} note={null} disconnect={disconnect} />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe("Disconnecting didn't work. Try again."));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("lists recent posts: a posted one links to YouTube, the rest say how they ended", () => {
    show({
      youtube: channel(),
      posts: [
        { id: "p2", title: "Second", visibility: "public", status: "uploading", url: null, postedBy: "Ada", projectName: "Robot reveal", createdAt: "2026-11-17T11:59:00.000Z" },
        { id: "p1", title: "Match recap", visibility: "unlisted", status: "posted", url: "https://youtu.be/video000001", postedBy: "Bo", projectName: null, createdAt: "2026-11-17T09:00:00.000Z" },
        { id: "p0", title: "Old", visibility: "private", status: "failed", url: null, postedBy: null, projectName: null, createdAt: "2026-11-15T12:00:00.000Z" },
      ],
    });
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "SecondUploading · Public · Ada · from Robot reveal · 1 minute ago",
      "Match recapPosted · Unlisted · Bo · 3 hours ago",
      "OldDidn't finish · Private · 2 days ago",
    ]);
    const link = within(items[1]).getByRole("link", { name: "Match recap" });
    expect(link.getAttribute("href")).toBe("https://youtu.be/video000001");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(within(items[0]).queryByRole("link")).toBeNull();
  });
});

describe("the disconnect action", () => {
  const deps = (disconnect: () => Promise<void>) => {
    const revalidate = vi.fn();
    return { revalidate, actions: makeSocialActions({ db: () => testDb, requireUser: async () => testUser({ id: "u1" }), disconnect, revalidate }) };
  };

  it("disconnects as the signed-in person and redraws the pages", async () => {
    const disconnect = vi.fn(async () => {});
    const { actions, revalidate } = deps(disconnect);
    expect(await actions.disconnect("team_x")).toEqual({});
    expect(disconnect).toHaveBeenCalledWith(testDb, { spaceId: "team_x", byUserId: "u1" });
    expect(revalidate).toHaveBeenCalledOnce();
  });

  it("says a refusal in plain words, never whether the space exists", async () => {
    expect(await deps(async () => Promise.reject(new ServiceError("NOT_FOUND", 404, "Space not found"))).actions.disconnect("x")).toEqual({ error: "Disconnecting didn't work. Try again." });
    expect(await deps(async () => Promise.reject(new ServiceError("NOT_CONNECTED", 409, "This space has no YouTube channel connected."))).actions.disconnect("x")).toEqual({ error: "This space has no YouTube channel connected." });
    await expect(deps(async () => Promise.reject(new Error("boom"))).actions.disconnect("x")).rejects.toThrow("boom");
  });
});
