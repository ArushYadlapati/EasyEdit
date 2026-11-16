import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import { hasOnboarded, markOnboarded } from "@/lib/onboarding/state";
import { makeTestDb } from "../helpers/db";

async function setup(): Promise<DB> {
  const db = await makeTestDb();
  await db.insert(user).values([
    { id: "u-ada", name: "Ada", email: "ada@gmail.com" },
    { id: "u-vic", name: "Vic", email: "vic@gmail.com" },
  ]);
  return db;
}

describe("the onboarding marker", () => {
  it("a new user is not onboarded", async () => {
    const db = await setup();
    expect(await hasOnboarded(db, "u-ada")).toBe(false);
  });

  it("marking makes it so, per person", async () => {
    const db = await setup();
    await markOnboarded(db, "u-ada");
    expect(await hasOnboarded(db, "u-ada")).toBe(true);
    expect(await hasOnboarded(db, "u-vic")).toBe(false);
  });

  it("marking twice is fine", async () => {
    const db = await setup();
    await markOnboarded(db, "u-ada");
    await markOnboarded(db, "u-ada");
    expect(await hasOnboarded(db, "u-ada")).toBe(true);
  });

  it("the migration's backfill marks users who already existed", async () => {
    const db = await setup();
    const file = readFileSync("drizzle/0020_onboarding.sql", "utf8");
    const statement = file.split("--> statement-breakpoint").map((s) => s.trim()).find((s) => /^insert into "onboarding"/i.test(s));
    expect(statement).toBeTruthy();
    await db.execute(sql.raw(statement!));
    expect(await hasOnboarded(db, "u-ada")).toBe(true);
    expect(await hasOnboarded(db, "u-vic")).toBe(true);
  });
});
