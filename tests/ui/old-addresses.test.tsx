// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardRedirect from "@/app/(dashboard)/dashboard/page";
import EditorRedirect from "@/app/(editor)/editor/[id]/page";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { createFolder } from "@/lib/projects/folders";
import { createProject } from "@/lib/projects/service";
import { rememberSpace } from "@/lib/spaces/service";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}
class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  notFound: () => {
    throw new NotFound();
  },
}));
const signedIn = vi.hoisted(() => ({ user: null as CurrentUser | null }));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
// These accounts are past the first-visit flow (welcome-page.test.tsx covers /welcome).
vi.mock("@/lib/onboarding/state", () => ({ hasOnboarded: async () => true, markOnboarded: async () => {} }));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));

const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };
const bea: CurrentUser = { id: "u2", email: "bea@gmail.com", name: "Bea", image: null, allowlistRole: "editor" };
const out: CurrentUser = { id: "u3", email: "o@gmail.com", name: "Out", image: null, allowlistRole: "viewer" };

let teamProject: string;
let beaProject: string;
let teamFolder: string;

beforeEach(async () => {
  testDb = await makeTestDb();
  for (const p of [ada, bea, out]) await joinSpace(testDb, p, "editor", personalSpaceId(p.id));
  for (const p of [ada, bea]) await joinSpace(testDb, p, "editor");
  teamProject = (await createProject(testDb, testActor({ userId: "u1" }), { name: "T", format: "short_9x16" })).id;
  beaProject = (await createProject(testDb, testActor({ userId: "u2", spaceId: personalSpaceId("u2"), role: "admin" }), { name: "B", format: "short_9x16" })).id;
  teamFolder = (await createFolder(testDb, testActor({ userId: "u1" }), "Season")).id;
});

async function target(run: () => Promise<unknown>): Promise<string | "notFound"> {
  try {
    await run();
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    if (e instanceof NotFound) return "notFound";
    throw e;
  }
  throw new Error("no redirect");
}
const dashboard = (person: CurrentUser, q: Record<string, string> = {}) => {
  signedIn.user = person;
  return target(() => DashboardRedirect({ params: Promise.resolve({}), searchParams: Promise.resolve(q) } as never));
};
const editor = (person: CurrentUser, id: string) => {
  signedIn.user = person;
  return target(() => EditorRedirect({ params: Promise.resolve({ id }) } as never));
};

describe("old addresses redirect", () => {
  it("/editor/<id> goes to the project's space, or is not found", async () => {
    expect(await editor(ada, teamProject)).toBe(`/s/seattle-solvers/editor/${teamProject}`);
    expect(await editor(ada, beaProject)).toBe("notFound");
    expect(await editor(out, teamProject)).toBe("notFound");
    expect(await editor(bea, beaProject)).toBe(`/s/personal/editor/${beaProject}`);
    expect(await editor(ada, "nope")).toBe("notFound");
  });

  it("/dashboard goes to the last space, personal when there is none", async () => {
    expect(await dashboard(ada)).toBe("/s/personal");
    await rememberSpace(testDb, "u1", SEED_TEAM_ID);
    expect(await dashboard(ada)).toBe("/s/seattle-solvers");
  });

  it("/dashboard?folder=<id> goes to the folder's space when you are in it", async () => {
    expect(await dashboard(ada, { folder: teamFolder })).toBe(`/s/seattle-solvers?folder=${teamFolder}`);
    // Not a member: nothing about the folder leaks, the person lands on their own space with the query kept.
    expect(await dashboard(out, { folder: teamFolder })).toBe(`/s/personal?folder=${teamFolder}`);
  });

  it("/dashboard keeps other queries such as ?passkeys=1", async () => {
    expect(await dashboard(ada, { passkeys: "1" })).toBe("/s/personal?passkeys=1");
  });

  it("a person with no personal space yet still lands on one", async () => {
    const fresh: CurrentUser = { id: "u9", email: "n@gmail.com", name: "New", image: null, allowlistRole: "viewer" };
    await joinSpace(testDb, fresh, "viewer", SEED_TEAM_ID);
    expect(await dashboard(fresh)).toBe("/s/personal");
  });
});
