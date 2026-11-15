import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rowsOf, type DB } from "@/db";
import { projectOpens, user } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import { listRecentProjectIds, recordOpen } from "@/lib/projects/opens";
import { createProject, deleteProject, renameProject } from "@/lib/projects/service";
import { testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const u1: Actor = testActor({ role: "editor" });
const u2: Actor = testActor({ userId: "u2", email: "u2@gmail.com", role: "editor" });

// PGlite's clock has millisecond resolution; wait so consecutive opens get distinct timestamps.
const nextMillisecond = () => new Promise((resolve) => setTimeout(resolve, 5));

async function setup() {
  const db = await makeTestDb();
  await db.insert(user).values([
    { id: "u1", name: "U1", email: "u1@gmail.com" },
    { id: "u2", name: "U2", email: "u2@gmail.com" },
  ]);
  return db;
}

const newProject = async (db: DB, name: string) => (await createProject(db, u1, { name, format: "short_9x16" })).id;

async function openCount(db: DB): Promise<number> {
  const rows = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::integer as n from project_opens`));
  return rows[0].n;
}

describe("recent opens", () => {
  it("your opens, newest first, one row per project", async () => {
    const db = await setup();
    const a = await newProject(db, "A");
    const b = await newProject(db, "B");
    await recordOpen(db, u1, a);
    await nextMillisecond();
    await recordOpen(db, u1, b);
    await nextMillisecond();
    await recordOpen(db, u1, a);
    expect(await listRecentProjectIds(db, u1)).toEqual([a, b]);
    expect(await listRecentProjectIds(db, u2)).toEqual([]);
    expect(await openCount(db)).toBe(2);
  });

  it("only live projects, at most six by default", async () => {
    const db = await setup();
    const ids: string[] = [];
    for (let i = 1; i <= 7; i++) ids.push(await newProject(db, `P${i}`));
    for (const id of ids) {
      await recordOpen(db, u1, id);
      await nextMillisecond();
    }
    const [p1, p2, p3, p4, p5, p6, p7] = ids;
    expect(await listRecentProjectIds(db, u1)).toEqual([p7, p6, p5, p4, p3, p2]);
    await deleteProject(db, u1, p7);
    expect(await listRecentProjectIds(db, u1)).toEqual([p6, p5, p4, p3, p2, p1]);
  });

  it("opens at the same moment are in project id order", async () => {
    const db = await setup();
    const [a, b] = [await newProject(db, "A"), await newProject(db, "B")].sort();
    // Rewriting A puts its row after B's in the table, so only the id order can put A first.
    await renameProject(db, u1, a, "A2");
    const openedAt = new Date("2026-11-13T12:00:00Z");
    await db.insert(projectOpens).values({ userId: "u1", projectId: b, openedAt });
    await db.insert(projectOpens).values({ userId: "u1", projectId: a, openedAt });
    expect(await listRecentProjectIds(db, u1)).toEqual([a, b]);
  });

  it("opening a deleted or unknown project records nothing", async () => {
    const db = await setup();
    const gone = await newProject(db, "Gone");
    await deleteProject(db, u1, gone);
    await expect(recordOpen(db, u1, gone)).resolves.toBeUndefined();
    await expect(recordOpen(db, u1, "nope")).resolves.toBeUndefined();
    expect(await openCount(db)).toBe(0);
  });

  it("a viewer's opens count", async () => {
    const db = await setup();
    const a = await newProject(db, "A");
    const viewer: Actor = testActor({ userId: "u2", email: "u2@gmail.com", role: "viewer" });
    await recordOpen(db, viewer, a);
    expect(await listRecentProjectIds(db, viewer)).toEqual([a]);
  });
});
