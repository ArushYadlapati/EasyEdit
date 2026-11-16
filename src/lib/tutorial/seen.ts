import { sql } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";

// Whether this person has already been shown the intro tutorial.
export async function hasSeenTutorial(db: DB, userId: string): Promise<boolean> {
  const result = await db.execute(sql`select 1 from tutorial_views where user_id = ${userId}`);
  return rowsOf(result).length > 0;
}

// Remembers that the person has seen it. Marking again changes nothing, so two tabs closing the dialog is fine.
export async function markTutorialSeen(db: DB, userId: string): Promise<void> {
  await db.execute(sql`insert into tutorial_views (user_id, seen_at) values (${userId}, now()) on conflict (user_id) do nothing`);
}
