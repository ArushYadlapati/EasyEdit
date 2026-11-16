import { sql } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";

// Whether this person has finished (or skipped) the first-visit flow. Accounts that existed before it count as done.
export async function hasOnboarded(db: DB, userId: string): Promise<boolean> {
  const result = await db.execute(sql`select 1 from onboarding where user_id = ${userId}`);
  return rowsOf(result).length > 0;
}

// Remembers that the person is done. Marking again changes nothing, so two tabs finishing together is fine.
export async function markOnboarded(db: DB, userId: string): Promise<void> {
  await db.execute(sql`insert into onboarding (user_id, finished_at) values (${userId}, now()) on conflict (user_id) do nothing`);
}
