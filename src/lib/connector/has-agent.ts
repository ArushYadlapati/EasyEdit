import "server-only";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { agentToken, oauthConsent, user } from "@/db/schema";

// Whether anything acts for the person as an agent: an agent they signed in to, or an access token something has
// used. One small query, for the dashboard header's AI agents link (a made token nothing has used is not connected).
export async function hasConnectedAgent(db: DB, userId: string): Promise<boolean> {
  const [row] = await db
    .select({
      any: sql<boolean>`exists (select 1 from ${oauthConsent} where ${oauthConsent.userId} = ${userId})
        or exists (select 1 from ${agentToken} where ${agentToken.userId} = ${userId} and ${agentToken.lastUsedAt} is not null)`,
    })
    .from(user)
    .where(eq(user.id, userId));
  return row?.any === true;
}
