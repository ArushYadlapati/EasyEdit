import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rowsOf, type DB } from "@/db";
import { user } from "@/db/schema";
import { hasSeenTutorial, markTutorialSeen } from "@/lib/tutorial/seen";
import { makeTestDb } from "../helpers/db";

async function setup(): Promise<DB> {
  const db = await makeTestDb();
  await db.insert(user).values([
    { id: "u-ada", name: "Ada", email: "ada@gmail.com" },
    { id: "u-vic", name: "Vic", email: "vic@gmail.com" },
  ]);
  return db;
}

const marks = async (db: DB) => rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from tutorial_views`))[0].n;

describe("the tutorial's seen mark", () => {
  it("nobody has seen it at first", async () => {
    const db = await setup();
    expect(await hasSeenTutorial(db, "u-ada")).toBe(false);
  });

  it("is kept per person", async () => {
    const db = await setup();
    await markTutorialSeen(db, "u-ada");
    expect(await hasSeenTutorial(db, "u-ada")).toBe(true);
    expect(await hasSeenTutorial(db, "u-vic")).toBe(false);
  });

  it("marking twice changes nothing and keeps the first time", async () => {
    const db = await setup();
    await markTutorialSeen(db, "u-ada");
    const first = rowsOf<{ seen_at: unknown }>(await db.execute(sql`select seen_at from tutorial_views where user_id = 'u-ada'`))[0].seen_at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await markTutorialSeen(db, "u-ada");
    expect(await marks(db)).toBe(1);
    expect(rowsOf<{ seen_at: unknown }>(await db.execute(sql`select seen_at from tutorial_views where user_id = 'u-ada'`))[0].seen_at).toEqual(first);
  });

  it("goes with the account when it is deleted", async () => {
    const db = await setup();
    await markTutorialSeen(db, "u-ada");
    await db.delete(user).where(eq(user.id, "u-ada"));
    expect(await marks(db)).toBe(0);
  });
});
