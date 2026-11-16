import { describe, expect, it, vi } from "vitest";
import { rowsOf, type DB } from "@/db";
import { user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import { actorIn } from "@/lib/spaces/access";
import { makeInviteActions } from "@/lib/spaces/invite-actions";
import { inviteToTeam } from "@/lib/spaces/invites";
import { createTeam, ensurePersonalSpace } from "@/lib/spaces/service";
import { sql } from "drizzle-orm";
import { testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}

async function setup() {
  const db = await makeTestDb();
  for (const [id, name, email] of [
    ["u1", "Uma", "u1@gmail.com"],
    ["ada", "Ada", "ada@example.com"],
    ["bob", "Bob", "bob@example.com"],
  ]) {
    await db.insert(user).values({ id, name, email, emailVerified: true });
    await ensurePersonalSpace(db, { id });
  }
  const team = await createTeam(db, { name: "Robotics Club", byUserId: "u1" });
  const admin = (await actorIn(db, testUser({ id: "u1" }), team.id)) as Actor;
  const inv = await inviteToTeam(db, admin, { email: "ada@example.com", role: "editor" });
  return { db, team, inviteId: inv.id };
}

const as = (id: string, email: string): CurrentUser => ({ ...testUser({ id, email }), allowlistRole: null });

function actionsAs(db: DB, who: CurrentUser) {
  const revalidate = vi.fn();
  const redirect = vi.fn((to: string): never => {
    throw new Redirected(to);
  });
  return { actions: makeInviteActions({ db: () => db, requireUser: async () => who, revalidate, redirect }), revalidate, redirect };
}

describe("invite actions", () => {
  it("accept joins the team and redirects to it", async () => {
    const { db, team, inviteId } = await setup();
    const { actions, revalidate } = actionsAs(db, as("ada", "ada@example.com"));
    await expect(actions.accept(inviteId)).rejects.toThrow(new Redirected(`/s/${team.slug}`));
    expect(revalidate).toHaveBeenCalled();
    const rows = rowsOf<{ role: string }>(await db.execute(sql`select role from member where user_id = 'ada' and organization_id = ${team.id}`));
    expect(rows[0].role).toBe("editor");
  });

  it("accept by someone else returns the refusal and does not redirect", async () => {
    const { db, inviteId } = await setup();
    const { actions, redirect } = actionsAs(db, as("bob", "bob@example.com"));
    expect(await actions.accept(inviteId)).toEqual({ error: "This invite is for a different email address." });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("decline redirects to /dashboard; a second try returns the used message", async () => {
    const { db, inviteId } = await setup();
    const { actions } = actionsAs(db, as("ada", "ada@example.com"));
    await expect(actions.decline(inviteId)).rejects.toThrow(new Redirected("/dashboard"));
    expect(await actions.decline(inviteId)).toEqual({ error: "This invite has already been used or cancelled." });
  });
});
