import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rowsOf, type DB } from "@/db";
import { driveConnection, spaceStorage, user } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import type { Role } from "@/lib/allowlist/service";
import { LIMITS } from "@/lib/limits";
import { actorIn } from "@/lib/spaces/access";
import { leaveTeam, listTeamMembers, removeMember, setMemberRole } from "@/lib/spaces/members";
import { createTeam, ensurePersonalSpace, listMySpaces, roleIn } from "@/lib/spaces/service";
import { SEED_TEAM_ID, personalSpaceId } from "@/lib/spaces/types";
import { joinSpace, testActor, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const SPACE_NOT_FOUND = { code: "NOT_FOUND", status: 404, message: "Space not found" };
const MANAGED = { code: "MANAGED_ELSEWHERE", status: 409, message: "Seattle Solvers' members are managed on the Admin page." };
const FORBIDDEN = { code: "FORBIDDEN", status: 403 };
const NOT_IN_TEAM = { code: "NOT_FOUND", status: 404, message: "They're not in this team." };
const LAST_ADMIN = { code: "LAST_ADMIN", status: 409, message: "A team needs at least one admin. Make someone else an admin first." };
const OWNER_STAYS = { code: "STORAGE_OWNER", status: 409, message: "This team's videos are stored in their Google Drive, so they can't leave or be removed yet." };
const OWNER_ADMIN = { code: "STORAGE_OWNER", status: 409, message: "This team's videos are stored in their Google Drive, so they need to stay an admin." };
const LEAVE_INSTEAD = { code: "INVALID", status: 400, message: "To leave the team, use Leave team." };

// People with accounts: u1 (who makes the team), u2, u3, u4, and Ada.
async function setup() {
  const db = await makeTestDb();
  for (const [id, name, email] of [
    ["u1", "Uma", "u1@gmail.com"],
    ["u2", "Ben", "u2@gmail.com"],
    ["u3", "cara", "u3@gmail.com"],
    ["u4", "Dev", "u4@gmail.com"],
    ["ada", "Ada", "ada@example.com"],
  ]) {
    await db.insert(user).values({ id, name, email, emailVerified: true });
    await ensurePersonalSpace(db, { id });
  }
  const team = await createTeam(db, { name: "Robotics Club", byUserId: "u1" });
  return { db, team: team.id };
}

// The person acting in a space, as a route handler builds it from their member row.
async function as(db: DB, id: string, spaceId: string): Promise<Actor> {
  const actor = await actorIn(db, testUser({ id }), spaceId);
  if (!actor) throw new Error(`${id} is not in ${spaceId}`);
  return actor;
}

// Puts an existing account in the team with a role (the way an accepted invite does), so a test can start from a team
// with members.
async function addAs(db: DB, team: string, _adminId: string, email: string, role: Role) {
  const rows = rowsOf<{ id: string }>(await db.execute(sql`select id from "user" where lower(email) = ${email.toLowerCase()}`));
  await joinSpace(db, { id: rows[0]!.id }, role, team);
}

async function adminsOf(db: DB, spaceId: string): Promise<string[]> {
  const result = await db.execute(sql`select user_id from member where organization_id = ${spaceId} and role = 'admin' order by user_id`);
  return rowsOf<{ user_id: string }>(result).map((r) => r.user_id);
}

async function memberRows(db: DB) {
  const result = await db.execute(sql`
    select m.organization_id, m.user_id, o.kind from member m join organization o on o.id = m.organization_id order by m.id
  `);
  return rowsOf<{ organization_id: string; user_id: string; kind: string }>(result);
}

// Storage in u2's Google Drive for the team.
async function storageOwnedBy(db: DB, spaceId: string, userId: string) {
  await db.insert(driveConnection).values({ id: `dc_${userId}`, userId, googleSub: `sub_${userId}`, email: `${userId}@gmail.com`, refreshTokenEnc: "x", scopes: "drive.file" });
  await db.insert(spaceStorage).values({ spaceId, kind: "google_account", connectionId: `dc_${userId}`, rootFolderId: "folder_x", folderName: "EasyEdit", createdBy: userId });
}

describe("team limits", () => {
  it("states the limit as 100 by default", () => {
    expect(LIMITS.teamMembers).toBe(100);
  });
});

describe("only admins change membership", () => {
  it("gives an editor and a viewer 403 on add, set role and remove", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "editor");
    await addAs(db, team, "u1", "u3@gmail.com", "viewer");
    await addAs(db, team, "u1", "u4@gmail.com", "viewer");
    for (const id of ["u2", "u3"]) {
      const actor = await as(db, id, team);
      await expect(setMemberRole(db, actor, { userId: "u4", role: "admin" })).rejects.toMatchObject(FORBIDDEN);
      await expect(setMemberRole(db, actor, { userId: id, role: "admin" })).rejects.toMatchObject(FORBIDDEN);
      await expect(removeMember(db, actor, "u4")).rejects.toMatchObject(FORBIDDEN);
    }
    expect(await roleIn(db, "ada", team)).toBeNull();
    expect(await roleIn(db, "u4", team)).toBe("viewer");
  });

  it("goes by the member row, not the role the actor claims", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "viewer");
    const claimsAdmin = testActor({ userId: "u2", email: "u2@gmail.com", role: "admin", spaceId: team });
    await expect(setMemberRole(db, claimsAdmin, { userId: "u2", role: "admin" })).rejects.toMatchObject(FORBIDDEN);
    expect(await roleIn(db, "u2", team)).toBe("viewer");
  });

  it("answers NOT_FOUND to a hand-built actor for a team the person isn't in, on every function", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "editor");
    const outsider = testActor({ userId: "u3", email: "u3@gmail.com", role: "admin", spaceId: team });
    await expect(listTeamMembers(db, outsider)).rejects.toMatchObject(SPACE_NOT_FOUND);
    await expect(setMemberRole(db, outsider, { userId: "u2", role: "viewer" })).rejects.toMatchObject(SPACE_NOT_FOUND);
    await expect(removeMember(db, outsider, "u2")).rejects.toMatchObject(SPACE_NOT_FOUND);
    await expect(leaveTeam(db, outsider)).rejects.toMatchObject(SPACE_NOT_FOUND);
    expect(await roleIn(db, "u3", team)).toBeNull();
    expect(await roleIn(db, "u4", team)).toBeNull();
    expect(await roleIn(db, "u2", team)).toBe("editor");
  });

  it("answers NOT_FOUND for an unknown space, and to an AI agent acting for an admin", async () => {
    const { db, team } = await setup();
    const unknown = testActor({ userId: "u1", spaceId: "team_nowhere" });
    await expect(listTeamMembers(db, unknown)).rejects.toMatchObject(SPACE_NOT_FOUND);
    const agent = testActor({ userId: "claude:u1", email: "u1@gmail.com", role: "admin", spaceId: team });
    await expect(listTeamMembers(db, agent)).rejects.toMatchObject(SPACE_NOT_FOUND);
    await expect(leaveTeam(db, agent)).rejects.toMatchObject(SPACE_NOT_FOUND);
    expect(await roleIn(db, "u2", team)).toBeNull();
  });

  it("answers NOT_FOUND to an actor in a personal space", async () => {
    const { db } = await setup();
    const actor = await as(db, "u1", personalSpaceId("u1"));
    await expect(listTeamMembers(db, actor)).rejects.toMatchObject(SPACE_NOT_FOUND);
  });
});

describe("a team always keeps an admin", () => {
  it("won't let the only admin demote themselves or leave", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "editor");
    const admin = await as(db, "u1", team);
    await expect(setMemberRole(db, admin, { userId: "u1", role: "editor" })).rejects.toMatchObject(LAST_ADMIN);
    await expect(setMemberRole(db, admin, { userId: "u1", role: "viewer" })).rejects.toMatchObject(LAST_ADMIN);
    await expect(leaveTeam(db, admin)).rejects.toMatchObject(LAST_ADMIN);
    expect(await adminsOf(db, team)).toEqual(["u1"]);
    // Making yourself admin again is a no-op, not a refusal.
    await setMemberRole(db, admin, { userId: "u1", role: "admin" });
    expect(await adminsOf(db, team)).toEqual(["u1"]);
  });

  it("with two admins, one can demote the other and then can't demote themselves", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "admin");
    const u1 = await as(db, "u1", team);
    await setMemberRole(db, u1, { userId: "u2", role: "editor" });
    expect(await roleIn(db, "u2", team)).toBe("editor");
    await expect(setMemberRole(db, u1, { userId: "u1", role: "viewer" })).rejects.toMatchObject(LAST_ADMIN);
    expect(await adminsOf(db, team)).toEqual(["u1"]);
  });

  it("leaves exactly one admin when two admins demote each other at once", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "admin");
    const u1 = await as(db, "u1", team);
    const u2 = await as(db, "u2", team);
    const results = await Promise.allSettled([
      setMemberRole(db, u1, { userId: "u2", role: "editor" }),
      setMemberRole(db, u2, { userId: "u1", role: "editor" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["FORBIDDEN", "LAST_ADMIN"]).toContain(refused.reason.code);
    expect(await adminsOf(db, team)).toHaveLength(1);
  });

  it("lets two admins leave at once only while one stays", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "admin");
    const results = await Promise.allSettled([leaveTeam(db, await as(db, "u1", team)), leaveTeam(db, await as(db, "u2", team))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await adminsOf(db, team)).toHaveLength(1);
  });

  it("lets you remove the only other admin while you stay admin", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "admin");
    await removeMember(db, await as(db, "u1", team), "u2");
    expect(await roleIn(db, "u2", team)).toBeNull();
    expect(await adminsOf(db, team)).toEqual(["u1"]);
  });

  it("lets a second admin leave", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "admin");
    await leaveTeam(db, await as(db, "u2", team));
    expect(await adminsOf(db, team)).toEqual(["u1"]);
  });
});

describe("the storage owner stays", () => {
  async function ownedTeam() {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "admin");
    await addAs(db, team, "u1", "u3@gmail.com", "editor");
    await storageOwnedBy(db, team, "u2");
    return { db, team };
  }

  it("won't remove the owner, or let them leave", async () => {
    const { db, team } = await ownedTeam();
    await expect(removeMember(db, await as(db, "u1", team), "u2")).rejects.toMatchObject(OWNER_STAYS);
    await expect(leaveTeam(db, await as(db, "u2", team))).rejects.toMatchObject(OWNER_STAYS);
    expect(await roleIn(db, "u2", team)).toBe("admin");
  });

  it("won't demote the owner to editor or viewer, by another admin or themselves", async () => {
    const { db, team } = await ownedTeam();
    for (const by of ["u1", "u2"]) {
      for (const role of ["editor", "viewer"] as const) {
        await expect(setMemberRole(db, await as(db, by, team), { userId: "u2", role })).rejects.toMatchObject(OWNER_ADMIN);
      }
    }
    expect(await roleIn(db, "u2", team)).toBe("admin");
    // Everyone else is still managed as usual.
    await setMemberRole(db, await as(db, "u2", team), { userId: "u1", role: "editor" });
    expect(await adminsOf(db, team)).toEqual(["u2"]);
  });

  it("marks storageOwner only on the owner in the list", async () => {
    const { db, team } = await ownedTeam();
    const list = await listTeamMembers(db, await as(db, "u3", team));
    expect(list.filter((m) => m.storageOwner).map((m) => m.userId)).toEqual(["u2"]);
  });

  it("marks no one in a team without storage", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "admin");
    expect((await listTeamMembers(db, await as(db, "u1", team))).some((m) => m.storageOwner)).toBe(false);
  });
});

describe("personal spaces have no members screen", () => {
  it("answers NOT_FOUND on every function, even for the space's owner, and writes no member row there", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "editor");
    const before = await memberRows(db);
    const owner = await as(db, "u1", personalSpaceId("u1"));
    expect(owner.role).toBe("admin");
    await expect(listTeamMembers(db, owner)).rejects.toMatchObject(SPACE_NOT_FOUND);
    await expect(setMemberRole(db, owner, { userId: "u1", role: "viewer" })).rejects.toMatchObject(SPACE_NOT_FOUND);
    await expect(removeMember(db, owner, "u1")).rejects.toMatchObject(SPACE_NOT_FOUND);
    await expect(leaveTeam(db, owner)).rejects.toMatchObject(SPACE_NOT_FOUND);
    // A hand-built actor for someone else's personal space too.
    const intruder = testActor({ userId: "u2", email: "u2@gmail.com", role: "admin", spaceId: personalSpaceId("u1") });
    await expect(leaveTeam(db, intruder)).rejects.toMatchObject(SPACE_NOT_FOUND);

    const after = await memberRows(db);
    expect(after).toEqual(before);
    const personal = after.filter((r) => r.kind === "personal");
    // One row per personal space, its owner's.
    expect(personal.every((r) => r.organization_id === personalSpaceId(r.user_id))).toBe(true);
  });
});

describe("seattle solvers is managed on the admin page", () => {
  async function seeded() {
    const { db } = await setup();
    for (const [id, role] of [["u1", "admin"], ["u2", "editor"]] as const) {
      await db.execute(sql`
        insert into member (id, organization_id, user_id, role, created_at) values (${"mt_" + id}, ${SEED_TEAM_ID}, ${id}, ${role}, now())
      `);
    }
    return db;
  }

  it("answers MANAGED_ELSEWHERE to add, set role, remove and leave", async () => {
    const db = await seeded();
    const admin = await as(db, "u1", SEED_TEAM_ID);
    await expect(setMemberRole(db, admin, { userId: "u2", role: "viewer" })).rejects.toMatchObject(MANAGED);
    await expect(removeMember(db, admin, "u2")).rejects.toMatchObject(MANAGED);
    await expect(leaveTeam(db, admin)).rejects.toMatchObject(MANAGED);
    await expect(leaveTeam(db, await as(db, "u2", SEED_TEAM_ID))).rejects.toMatchObject(MANAGED);
    expect(await roleIn(db, "u3", SEED_TEAM_ID)).toBeNull();
    expect(await roleIn(db, "u2", SEED_TEAM_ID)).toBe("editor");
    expect(await roleIn(db, "u1", SEED_TEAM_ID)).toBe("admin");
  });

  it("lists its members", async () => {
    const db = await seeded();
    const list = await listTeamMembers(db, await as(db, "u2", SEED_TEAM_ID));
    expect(list.map((m) => [m.userId, m.role])).toEqual([["u1", "admin"], ["u2", "editor"]]);
  });
});

describe("leaving and removing", () => {
  it("drops a removed member's role and the team from their spaces", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "editor");
    await removeMember(db, await as(db, "u1", team), "u2");
    expect(await roleIn(db, "u2", team)).toBeNull();
    expect((await listMySpaces(db, "u2")).map((s) => s.id)).not.toContain(team);
    // Their personal space is untouched.
    expect(await roleIn(db, "u2", personalSpaceId("u2"))).toBe("admin");
  });

  it("refuses to remove yourself", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "admin");
    await expect(removeMember(db, await as(db, "u1", team), "u1")).rejects.toMatchObject(LEAVE_INSTEAD);
    expect(await roleIn(db, "u1", team)).toBe("admin");
  });

  it("takes a member who leaves out of the team", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "viewer");
    await leaveTeam(db, await as(db, "u2", team));
    expect(await roleIn(db, "u2", team)).toBeNull();
    expect((await listMySpaces(db, "u2")).map((s) => s.id)).not.toContain(team);
  });

  it("ends consistently when a member leaves while an admin changes their role, never with a database error", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "admin");
    await addAs(db, team, "u1", "u3@gmail.com", "viewer");
    const results = await Promise.allSettled([
      leaveTeam(db, await as(db, "u3", team)),
      setMemberRole(db, await as(db, "u1", team), { userId: "u3", role: "editor" }),
    ]);
    expect(results[0].status).toBe("fulfilled");
    // Either the role changed and then they left, or they left and the change found no one.
    if (results[1].status === "rejected") expect(results[1].reason).toMatchObject(NOT_IN_TEAM);
    expect(await roleIn(db, "u3", team)).toBeNull();
    expect(await adminsOf(db, team)).toEqual(["u1", "u2"]);
  });

  it("answers Space not found to a member who leaves after being removed", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u2@gmail.com", "viewer");
    const results = await Promise.allSettled([removeMember(db, await as(db, "u1", team), "u2"), leaveTeam(db, await as(db, "u2", team))]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: SPACE_NOT_FOUND });
    expect(await roleIn(db, "u2", team)).toBeNull();
  });

  it("answers NOT_FOUND for someone not in the team, on remove and set role", async () => {
    const { db, team } = await setup();
    const admin = await as(db, "u1", team);
    await expect(removeMember(db, admin, "u3")).rejects.toMatchObject(NOT_IN_TEAM);
    await expect(removeMember(db, admin, "nobody")).rejects.toMatchObject(NOT_IN_TEAM);
    await expect(setMemberRole(db, admin, { userId: "u3", role: "editor" })).rejects.toMatchObject(NOT_IN_TEAM);
    expect(await roleIn(db, "u3", team)).toBeNull();
  });
});

describe("listing members", () => {
  it("lists admins first, then by name ignoring case, then email, with what the screen shows", async () => {
    const { db, team } = await setup();
    await addAs(db, team, "u1", "u4@gmail.com", "viewer"); // Dev
    await addAs(db, team, "u1", "u3@gmail.com", "editor"); // cara
    await addAs(db, team, "u1", "u2@gmail.com", "admin"); // Ben
    await addAs(db, team, "u1", "ada@example.com", "viewer"); // Ada
    const list = await listTeamMembers(db, await as(db, "u4", team));
    expect(list.map((m) => m.name)).toEqual(["Ben", "Uma", "Ada", "cara", "Dev"]);
    expect(list[1]).toMatchObject({ userId: "u1", email: "u1@gmail.com", image: null, role: "admin", storageOwner: false });
    expect(list.every((m) => m.joinedAt instanceof Date)).toBe(true);
  });
});
