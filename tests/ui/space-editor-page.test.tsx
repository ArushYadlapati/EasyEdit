// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import EditorPage, { viewport } from "@/app/(editor)/s/[space]/editor/[id]/page";
import { EditorShell } from "@/components/editor/editor-shell";
import type { CurrentUser } from "@/lib/access-rules";
import { createEmptyDoc } from "@/lib/timeline";
import { act, render } from "../helpers/dom";

const viewer = vi.hoisted((): CurrentUser => ({ id: "u1", email: "u1@gmail.com", name: "U1", image: null, allowlistRole: "viewer" }));

vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => viewer),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
// A viewer in the project's space.
vi.mock("@/lib/spaces/access", () => ({
  actorIn: vi.fn(async (_db: unknown, user: CurrentUser, spaceId: string) => ({ userId: user.id, email: user.email, role: "viewer", spaceId })),
}));
vi.mock("@/lib/spaces/service", () => ({
  findMySpace: vi.fn(async () => ({ id: "s1", slug: "seattle-solvers", name: "Seattle Solvers", kind: "team", role: "viewer" })),
  listMySpaces: vi.fn(async () => []),
  spaceOfProject: vi.fn(async () => null),
}));
vi.mock("@/lib/spaces/storage", () => ({ storageState: vi.fn(async () => ({ ready: true })) }));
vi.mock("@/lib/projects/service", () => ({
  getProject: vi.fn(async () => ({
    id: "p1",
    name: "Qual",
    doc: createEmptyDoc("short_9x16"),
    version: 0,
    thumbnailVersion: 3,
  })),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const { Shell } = vi.hoisted(() => ({ Shell: vi.fn(() => null) }));
vi.mock("@/components/editor/editor-shell", () => ({ EditorShell: Shell }));
vi.mock("@/components/keep-signed-in", () => ({ KeepSignedIn: () => null }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the editor page", () => {
  it("is always dark, and says so to the browser's own dark mode (the Dark Reader lock is in its generated metadata)", () => {
    expect(viewport).toEqual({ colorScheme: "dark" });
  });

  it("opening the editor records the open once, for a viewer too", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(await EditorPage({ params: Promise.resolve({ space: "seattle-solvers", id: "p1" }) } as never));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/opened", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
    });
  });

  it("the editor gets the stored picture's version", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    render(await EditorPage({ params: Promise.resolve({ space: "seattle-solvers", id: "p1" }) } as never));
    await act(async () => {});
    // The mock is never cleared, and the test above renders first: the last call is this test's.
    expect(vi.mocked(EditorShell).mock.calls.at(-1)![0].initial).toMatchObject({
      projectId: "p1",
      version: 0,
      thumbnailVersion: 3,
    });
  });

  it("tells the editor whether personal spaces are offered yet, for the Brand kit tab's Style card", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const space = async () => {
      render(await EditorPage({ params: Promise.resolve({ space: "seattle-solvers", id: "p1" }) } as never));
      await act(async () => {});
      return vi.mocked(EditorShell).mock.calls.at(-1)![0].space;
    };
    expect(await space()).toMatchObject({ slug: "seattle-solvers", kind: "team", personalSoon: false });
    vi.stubEnv("PERSONAL_SPACES", "");
    expect(await space()).toMatchObject({ personalSoon: true });
  });
});
