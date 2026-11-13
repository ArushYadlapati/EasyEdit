// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import EditorPage from "@/app/(editor)/editor/[id]/page";
import type { CurrentUser } from "@/lib/access-rules";
import { createEmptyDoc } from "@/lib/timeline";
import { act, render } from "../helpers/dom";

const viewer = vi.hoisted((): CurrentUser => ({ id: "u1", email: "u1@gmail.com", name: "U1", image: null, role: "viewer" }));

vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => viewer),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/projects/service", () => ({
  getProject: vi.fn(async () => ({ id: "p1", name: "Qual", doc: createEmptyDoc("short_9x16"), version: 0 })),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/components/editor/editor-shell", () => ({ EditorShell: () => null }));
vi.mock("@/components/keep-signed-in", () => ({ KeepSignedIn: () => null }));

afterEach(() => vi.unstubAllGlobals());

describe("the editor page", () => {
  it("opening the editor records the open once, for a viewer too", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(await EditorPage({ params: Promise.resolve({ id: "p1" }) } as never));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/opened", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
    });
  });
});
