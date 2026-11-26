import { randomBytes } from "node:crypto";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StyleSettingsPage from "@/app/(dashboard)/s/[space]/settings/style/page";
import type { StylePageProps } from "@/components/style/style-page";
import type { DB } from "@/db";
import { socialConnection } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { createProject } from "@/lib/projects/service";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { updateStyle } from "@/lib/style/service";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

class NotFound extends Error {}
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  unstable_rethrow: () => {},
}));
const { signedIn } = vi.hoisted(() => ({ signedIn: { user: null as CurrentUser | null } }));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
// The page itself is the Style page's tests' to draw; here only what the server hands it matters.
vi.mock("@/components/style/style-page", () => ({ StylePage: () => null }));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));

const person = (id: string): CurrentUser => ({ id, email: `${id}@gmail.com`, name: id.toUpperCase(), image: null, allowlistRole: null });
const ada = person("u1"); // admin
const bea = person("u2"); // editor
const cy = person("u3"); // viewer
const out = person("u4"); // not in the team

async function open(who: CurrentUser, space = "seattle-solvers"): Promise<StylePageProps> {
  signedIn.user = who;
  const page = (await StyleSettingsPage({ params: Promise.resolve({ space }) } as never)) as ReactElement<StylePageProps>;
  return page.props;
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    if (e instanceof NotFound) return "notFound";
    throw e;
  }
  return "rendered";
}

beforeEach(async () => {
  vi.stubEnv("PERSONAL_SPACES", "");
  testDb = await makeTestDb();
  await joinSpace(testDb, ada, "admin");
  await joinSpace(testDb, bea, "editor");
  await joinSpace(testDb, cy, "viewer");
  await joinSpace(testDb, out, "admin", personalSpaceId(out.id));
  await joinSpace(testDb, ada, "admin", personalSpaceId(ada.id));
});
afterEach(() => void vi.unstubAllEnvs());

describe("the Style settings page", () => {
  it("is for every member; anyone else gets not found", async () => {
    expect(await outcome(() => open(out))).toBe("notFound");
    expect(await outcome(() => open(ada, "nowhere"))).toBe("notFound");
    expect(await outcome(() => open(cy))).toBe("rendered");
  });

  it("leads a personal space back to its coming-soon page while personal spaces are closed", async () => {
    expect(await outcome(() => open(ada, "personal"))).toBe("/s/personal");
    vi.stubEnv("PERSONAL_SPACES", "true");
    const props = await open(ada, "personal");
    expect(props).toMatchObject({ spaceId: personalSpaceId(ada.id), spaceName: null, canEdit: true });
  });

  it("lets editors and admins change it, and only admins connect a channel", async () => {
    expect(await open(cy)).toMatchObject({ canEdit: false, isAdmin: false });
    expect(await open(bea)).toMatchObject({ canEdit: true, isAdmin: false });
    expect(await open(ada)).toMatchObject({ canEdit: true, isAdmin: true });
  });

  it("hands over the space, its style, what it learns from and its newest projects as plain data", async () => {
    await updateStyle(testDb, testActor({ userId: ada.id }), { profile: { pace: "quick" }, notes: "Keep it bright." });
    for (let i = 1; i <= 22; i += 1) await createProject(testDb, testActor({ userId: ada.id }), { name: `Cut ${i}`, format: "short_9x16" });
    const props = await open(bea);
    expect(props).toMatchObject({
      spaceId: SEED_TEAM_ID,
      spaceSlug: "seattle-solvers",
      spaceName: "Seattle Solvers",
      initialStyle: { profile: { pace: "quick" }, notes: "Keep it bright.", updatedBy: ada.id },
      initialReferences: [],
      storageReady: false,
      channelOn: false,
    });
    expect(props.projects).toHaveLength(20);
    for (const project of props.projects) {
      expect(Object.keys(project).sort()).toEqual(["id", "name", "updatedAt"]);
      expect(typeof project.updatedAt).toBe("string");
    }
    // Only data crosses to the browser: no functions. The time it was drawn goes too, so the browser's "2 hours ago"
    // matches the server's.
    expect(Object.values(props).some((value) => typeof value === "function")).toBe(false);
    expect(props.now).toBeInstanceOf(Date);
  });

  it("offers the YouTube picker only where the space's channel is connected and its videos can be read", async () => {
    // A server without its YouTube settings has no channel to read, connected or not.
    const channel = { id: "sc_1", spaceId: SEED_TEAM_ID, platform: "youtube" as const, connectedBy: ada.id, googleSub: "g1", email: "c@gmail.com", refreshTokenEnc: "sealed", scopes: "" };
    await testDb.insert(socialConnection).values({ ...channel, channelId: "UCchannel", channelTitle: "Seattle Solvers" });
    expect((await open(bea)).channelOn).toBe(false);

    vi.stubEnv("YOUTUBE_CLIENT_ID", "yt-client");
    vi.stubEnv("YOUTUBE_CLIENT_SECRET", "yt-secret");
    vi.stubEnv("STORAGE_TOKEN_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("BETTER_AUTH_URL", "https://app.test");
    expect((await open(bea)).channelOn).toBe(true);
    expect((await open(ada)).channelOn).toBe(true);
    // A viewer can't add from it.
    expect((await open(cy)).channelOn).toBe(false);

    // Connected without leave to see its videos, broken, or not connected at all: nothing to pick from.
    await testDb.update(socialConnection).set({ channelId: null });
    expect((await open(bea)).channelOn).toBe(false);
    await testDb.update(socialConnection).set({ channelId: "UCchannel", brokenAt: new Date(), brokenReason: "revoked" });
    expect((await open(bea)).channelOn).toBe(false);
    await testDb.delete(socialConnection);
    expect((await open(bea)).channelOn).toBe(false);
  });
});
