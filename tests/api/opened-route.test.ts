import { describe, expect, it, vi } from "vitest";
import { user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { makeProjectHandlers } from "@/lib/projects/handlers";
import { listRecentProjectIds } from "@/lib/projects/opens";
import { createProject } from "@/lib/projects/service";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

function userWith(role: NonNullable<CurrentUser["allowlistRole"]>): CurrentUser {
  return { id: "u1", email: "u1@gmail.com", name: "U1", image: null, allowlistRole: role };
}

async function setup(role: NonNullable<CurrentUser["allowlistRole"]>) {
  const db = await makeTestDb();
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@gmail.com" });
  await joinSpace(db, { id: "u1" }, role);
  const auth = vi.fn<(req: Request) => Promise<CurrentUser>>(async () => userWith(role));
  return { db, auth, projects: makeProjectHandlers({ db: () => db, auth }) };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const opened = (id: string, headers?: Record<string, string>) =>
  new Request(`http://x/api/projects/${id}/opened`, { method: "POST", headers });

describe("the opened route", () => {
  it("POST opened answers 204 and records the open, for a viewer too", async () => {
    const { db, projects, auth } = await setup("viewer");
    const { id } = await createProject(db, testActor({ role: "editor" }), { name: "P", format: "short_9x16" });
    const res = await projects.opened(opened(id), ctx(id));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(auth).toHaveBeenCalledWith(expect.any(Request));
    expect(await listRecentProjectIds(db, testActor({ role: "viewer" }))).toEqual([id]);
  });

  it("an unknown project still answers 204", async () => {
    const { projects } = await setup("viewer");
    const res = await projects.opened(opened("nope"), ctx("nope"));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("a request from another site is refused", async () => {
    const { db, projects } = await setup("editor");
    const { id } = await createProject(db, testActor({ role: "editor" }), { name: "P", format: "short_9x16" });
    const res = await projects.opened(opened(id, { origin: "https://elsewhere.test", host: "x" }), ctx(id));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "FORBIDDEN", message: "This request came from another site." });
    expect(await listRecentProjectIds(db, testActor({ role: "editor" }))).toEqual([]);
  });
});
