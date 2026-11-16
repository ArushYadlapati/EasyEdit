import { sql } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";
import { LIMITS, type Limits } from "@/lib/limits";
import { ServiceError } from "@/lib/service-error";

// What one person may save through the website in a day, counted from what the database already holds. Only rows
// under the person's own user id count, so their AI agents (which write under agent actor ids, with their own
// allowance in lib/mcp/budget.ts) never use it up. The check reads and the write follows, so two requests at the same
// instant can both pass. That is accepted.
export type AppAction = "edit" | "project" | "upload";

const limit = (message: string) => new ServiceError("LIMIT_EXCEEDED", 400, message);

const DAY_USED_UP = "Today's limit for saved changes is used up (20 MB a day). It frees up over the next 24 hours.";
const TOO_MANY_AT_ONCE = "Too many changes at once. Wait a minute, then keep going.";

type Count = { used: number | string };

// Throws a LIMIT_EXCEEDED ServiceError when the person is at or over the limit for this action. One query.
export async function checkAppBudget(db: DB, userId: string, action: AppAction, limits: Limits = LIMITS): Promise<void> {
  if (action === "edit") {
    const [usage] = rowsOf<{ minute: number | string; bytes: number | string }>(
      await db.execute(sql`
        select
          count(*) filter (where created_at > now() - interval '1 minute') as minute,
          coalesce(sum(pg_column_size(ops) + coalesce(pg_column_size(inverse), 0)), 0) as bytes
        from project_ops
        where actor = ${userId} and created_at > now() - interval '1 day'
      `),
    );
    if (Number(usage.minute) >= limits.appEditsPerMinute) throw limit(TOO_MANY_AT_ONCE);
    if (Number(usage.bytes) >= limits.appEditBytesPerDay) throw limit(DAY_USED_UP);
    return;
  }
  // The messages are fixed text, with the real numbers, so tests may override the limits and still pin the wording.
  // Deleted projects and removed uploads still count: the work was done.
  const [usage] = rowsOf<Count>(
    await db.execute(
      action === "project"
        ? sql`select count(*) as used from projects where created_by = ${userId} and created_at > now() - interval '1 day'`
        : sql`select count(*) as used from assets where uploaded_by = ${userId} and created_at > now() - interval '1 day'`,
    ),
  );
  if (action === "project" && Number(usage.used) >= limits.appProjectsPerDay)
    throw limit("You've reached today's limit for new projects (25). It frees up over the next 24 hours.");
  if (action === "upload" && Number(usage.used) >= limits.appUploadsPerDay)
    throw limit("You've reached today's limit for uploads (500). It frees up over the next 24 hours.");
}

// Folders in one space, in total. One query.
export async function checkFolderCap(db: DB, spaceId: string, limits: Limits = LIMITS): Promise<void> {
  const [usage] = rowsOf<Count>(await db.execute(sql`select count(*) as used from folders where space_id = ${spaceId}`));
  if (Number(usage.used) >= limits.foldersPerSpace) throw limit("A space can have up to 200 folders.");
}
