import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { styleReference } from "@/db/schema";

// Kept apart from the style's service so that disconnecting a YouTube channel (social/connections) can call it
// without importing the service, which already reaches social/connections through actor and spaces/members.

// Deletes every reference the space's style added from its connected YouTube channel, with what YouTube said about
// each. Called when the channel is disconnected or another may have taken its place: YouTube's data is kept only while
// EasyEdit may read the channel it came from. Links people pasted themselves stay. No role check: the caller made the
// change.
export async function dropChannelReferences(db: DB, spaceId: string): Promise<void> {
  await db.delete(styleReference).where(and(eq(styleReference.spaceId, spaceId), eq(styleReference.provider, "channel")));
}
