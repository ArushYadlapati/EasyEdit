import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { member, organization, user } from "@/db/schema";
import { LIMITS } from "@/lib/limits";
import { ServiceError } from "@/lib/service-error";
import { canCreateTeam } from "@/lib/spaces/create-team-access";
import { createTeam, ensurePersonalSpace, listMySpaces } from "@/lib/spaces/service";
import { isReservedSlug, slugFromName } from "@/lib/spaces/slugs";
import { makeTeamActions } from "@/lib/spaces/team-actions";
import { SEED_TEAM_ID, type MySpace } from "@/lib/spaces/types";
import { makeTestDb } from "../helpers/db";

async function setup() {
  const db = await makeTestDb();
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@gmail.com" });
  await ensurePersonalSpace(db, { id: "u1" });
  return db;
}

describe("team names and slugs", () => {
  it("refuses a 200-character name and an empty one", async () => {
    const db = await setup();
    const message = "Give the team a name of up to 60 characters.";
    await expect(createTeam(db, { name: "x".repeat(200), byUserId: "u1" })).rejects.toMatchObject({ code: "INVALID", message });
    await expect(createTeam(db, { name: "   ", byUserId: "u1" })).rejects.toBeInstanceOf(ServiceError);
    expect((await createTeam(db, { name: "x".repeat(LIMITS.teamNameChars), byUserId: "u1" })).name).toHaveLength(60);
  });

  it("strips control, zero-width and direction characters and collapses spaces before the length check", async () => {
    const db = await setup();
    const team = await createTeam(db, { name: " Robo\u0000tics\u200B \t\n Club\u202E\u2066\uFEFF\u0085\u007F ", byUserId: "u1" });
    expect(team.name).toBe("Robotics Club");
    const [row] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, team.id));
    expect(row.name).toBe("Robotics Club");
    // 60 visible characters padded with invisible ones still fit.
    const padded = `${"x".repeat(LIMITS.teamNameChars)}${"\u200F".repeat(20)}`;
    expect((await createTeam(db, { name: padded, byUserId: "u1" })).name).toBe("x".repeat(LIMITS.teamNameChars));
  });

  it("strips the remaining hidden characters: soft hyphen, Arabic letter mark, combining grapheme joiner, Mongolian vowel separator and tags", async () => {
    const db = await setup();
    const cases: [string, string][] = [
      ["A­B", "AB"],
      ["A؜B", "AB"],
      ["A͏B", "AB"],
      ["A᠎B", "AB"],
      ["A\u{E0001}B", "AB"],
      ["A\u{E007F}B", "AB"],
      ["A\u{E0020}\u{E0041}B", "AB"],
    ];
    for (const [name, expected] of cases) {
      expect((await createTeam(db, { name, byUserId: "u1" })).name, JSON.stringify(name)).toBe(expected);
    }
  });

  it("refuses a name made only of the new hidden characters, with the usual message", async () => {
    const db = await setup();
    for (const name of ["­؜͏᠎", "\u{E0001}\u{E007F}"]) {
      await expect(createTeam(db, { name, byUserId: "u1" }), JSON.stringify(name)).rejects.toMatchObject({ code: "INVALID", message: "Give the team a name of up to 60 characters." });
    }
  });

  it("refuses a name that is empty once cleaned, with the usual message", async () => {
    const db = await setup();
    for (const name of ["\u200B\u200C\u200D", "\u202A\u202B\u202C\u202D\u202E", "\u2060\u2069\uFEFF", "\u0001 \u009F \t"]) {
      await expect(createTeam(db, { name, byUserId: "u1" }), JSON.stringify(name)).rejects.toMatchObject({ code: "INVALID", message: "Give the team a name of up to 60 characters." });
    }
  });

  it("refuses the name Personal in any case", async () => {
    const db = await setup();
    for (const name of ["Personal", "personal", "  PERSONAL  ", "Per\u200Bsonal", "PeRsOnAl\u202E"]) {
      await expect(createTeam(db, { name, byUserId: "u1" }), JSON.stringify(name)).rejects.toMatchObject({ code: "INVALID", message: 'Pick a different name. "Personal" is your own space.' });
    }
    expect((await createTeam(db, { name: "Personal Projects", byUserId: "u1" })).name).toBe("Personal Projects");
  });

  it("gives an emoji-only name the slug team", async () => {
    const db = await setup();
    const team = await createTeam(db, { name: "🚀🚀", byUserId: "u1" });
    expect(team.slug).toBe("team");
    expect(team.name).toBe("🚀🚀");
  });

  it("never gives the slug personal", async () => {
    const db = await setup();
    const team = await createTeam(db, { name: "Personal!", byUserId: "u1" });
    expect(team.slug).not.toBe("personal");
    expect(isReservedSlug(team.slug)).toBe(false);
  });

  it("numbers a repeated name, case-insensitively", async () => {
    const db = await setup();
    expect((await createTeam(db, { name: "Seattle Solvers", byUserId: "u1" })).slug).toBe("seattle-solvers-2");
    expect((await createTeam(db, { name: "SEATTLE solvers", byUserId: "u1" })).slug).toBe("seattle-solvers-3");
  });

  it("treats a stored upper-case slug as taken", async () => {
    const db = await setup();
    await db.insert(organization).values({ id: "team_x", name: "X", slug: "Robots", createdAt: new Date(), kind: "team" });
    expect((await createTeam(db, { name: "robots", byUserId: "u1" })).slug).toBe("robots-2");
  });

  it("keeps quotes and HTML as text in the name, with a clean slug", async () => {
    const db = await setup();
    const team = await createTeam(db, { name: `  <b>"Ada's" & co</b>  `, byUserId: "u1" });
    expect(team.name).toBe(`<b>"Ada's" & co</b>`);
    expect(team.slug).toBe("b-ada-s-co-b");
    expect(team.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("slugFromName: lowercase, collapsed, trimmed to 40, at least 3 characters", () => {
    expect(slugFromName("  --Hello,   World!!  ")).toBe("hello-world");
    expect(slugFromName("Café Ünïcode")).toBe("cafe-unicode");
    expect(slugFromName("a".repeat(100))).toHaveLength(40);
    expect(slugFromName(`${"a".repeat(39)} b`)).toBe("a".repeat(39));
    expect(slugFromName("")).toBe("team");
    expect(slugFromName("ab")).toBe("ab-team");
  });

  it("reserves personal, personal_*, settings, new and api", () => {
    for (const s of ["personal", "personal_u1", "settings", "new", "api"]) expect(isReservedSlug(s)).toBe(true);
    for (const s of ["personal-2", "newsroom", "apis"]) expect(isReservedSlug(s)).toBe(false);
    expect(slugFromName("Settings")).toBe("settings");
  });

  it("never hands out a reserved slug", async () => {
    const db = await setup();
    expect((await createTeam(db, { name: "Settings", byUserId: "u1" })).slug).toBe("settings-2");
    expect((await createTeam(db, { name: "New", byUserId: "u1" })).slug).toBe("new-2");
  });
});

describe("createTeam", () => {
  it("makes the creator the team's admin, listed with their spaces", async () => {
    const db = await setup();
    const team = await createTeam(db, { name: "Robots", byUserId: "u1" });
    expect(team).toMatchObject({ slug: "robots", name: "Robots", kind: "team", role: "admin" });
    expect(team.id).toMatch(/^team_.{12}$/);
    const members = await db.select().from(member).where(eq(member.organizationId, team.id));
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: "u1", role: "admin" });
    expect(members[0]!.id).toMatch(/^m_/);
    expect((await listMySpaces(db, "u1")).map((s) => s.slug)).toContain("robots");
  });

  it("allows ten teams in a day and refuses the eleventh", async () => {
    const db = await setup();
    const now = new Date("2026-11-14T12:00:00Z");
    for (let i = 0; i < LIMITS.teamsPerDay; i++) await createTeam(db, { name: `Team ${i}`, byUserId: "u1", now });
    await expect(createTeam(db, { name: "One more", byUserId: "u1", now })).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: "You've made 10 teams today. Try again tomorrow.",
    });
    await expect(createTeam(db, { name: "One more", byUserId: "u1", now: new Date(now.getTime() + 25 * 3600_000) })).resolves.toMatchObject({
      name: "One more",
    });
  });

  it("still blocks someone who made ten and then left one", async () => {
    const db = await setup();
    const teams = [];
    for (let i = 0; i < LIMITS.teamsPerDay; i++) teams.push(await createTeam(db, { name: `Mine ${i}`, byUserId: "u1" }));
    await db.delete(member).where(eq(member.organizationId, teams[0]!.id));
    await expect(createTeam(db, { name: "Again", byUserId: "u1" })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("lets someone added to ten recent teams still make one", async () => {
    const db = await setup();
    await db.insert(user).values({ id: "u2", name: "U2", email: "u2@gmail.com" });
    for (let i = 0; i < LIMITS.teamsPerDay; i++) {
      const team = await createTeam(db, { name: `Theirs ${i}`, byUserId: "u2" });
      await db.insert(member).values({ id: `m_added${i}`, organizationId: team.id, userId: "u1", role: "editor", createdAt: new Date() });
    }
    await expect(createTeam(db, { name: "Mine", byUserId: "u1" })).resolves.toMatchObject({ role: "admin" });
  });

  it("writes the same time to the team and its creator's row", async () => {
    const db = await setup();
    const team = await createTeam(db, { name: "Stamped", byUserId: "u1", now: new Date("2026-11-14T12:00:00.123Z") });
    const [o] = await db.select().from(organization).where(eq(organization.id, team.id));
    const [m] = await db.select().from(member).where(eq(member.organizationId, team.id));
    expect(o!.createdAt.getTime()).toBe(m!.createdAt.getTime());
  });

  it("gives up after 50 slug attempts with a plain message", async () => {
    const db = await setup();
    for (let n = 1; n <= 60; n++) {
      const slug = n === 1 ? "robots" : `robots-${n}`;
      await db.insert(organization).values({ id: `team_c${n}`, name: "C", slug, createdAt: new Date(), kind: "team" });
    }
    await expect(createTeam(db, { name: "Robots", byUserId: "u1" })).rejects.toMatchObject({
      message: "Couldn't make a web address for that name. Try a different name.",
    });
  });

  it("counts only the teams this person made, not ones they were added to", async () => {
    const db = await setup();
    await db.insert(user).values({ id: "u2", name: "U2", email: "u2@gmail.com" });
    for (let i = 0; i < LIMITS.teamsPerDay; i++) await createTeam(db, { name: `Other ${i}`, byUserId: "u2" });
    await expect(createTeam(db, { name: "Mine", byUserId: "u1" })).resolves.toMatchObject({ role: "admin" });
  });
});

describe("canCreateTeam and the action", () => {
  const seed = (role: "admin" | "editor"): MySpace => ({ id: SEED_TEAM_ID, slug: "seattle-solvers", name: "Seattle Solvers", kind: "team", role });
  it("is on when sign-up is open or for a Seattle Solvers admin", () => {
    expect(canCreateTeam([], { NODE_ENV: "test", OPEN_SIGNUP: "true" })).toBe(true);
    expect(canCreateTeam([seed("admin")], { NODE_ENV: "test" })).toBe(true);
    expect(canCreateTeam([seed("editor")], { NODE_ENV: "test" })).toBe(false);
    expect(canCreateTeam([], { NODE_ENV: "test" })).toBe(false);
  });

  it("creates through the action, and refuses someone who may not", async () => {
    const db = await setup();
    const current = { id: "u1", email: "u1@gmail.com", name: "U1", image: null, allowlistRole: null };
    let allowed = false;
    const actions = makeTeamActions({ db: () => db, requireUser: async () => current, revalidate: () => {}, canCreateTeam: async () => allowed });
    const form = new FormData();
    form.set("name", "Robots");
    expect(await actions.create(form)).toEqual({ error: "Creating teams isn't open yet." });
    allowed = true;
    expect(await actions.create(form)).toEqual({ slug: "robots" });
    form.set("name", "");
    expect((await actions.create(form)).error).toBe("Give the team a name of up to 60 characters.");
  });
});
