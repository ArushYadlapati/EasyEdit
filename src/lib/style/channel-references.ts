import { and, eq, exists, isNull, not, or } from "drizzle-orm";
import type { DB } from "@/db";
import { socialConnection, styleReference } from "@/db/schema";

// Kept apart from the style's service so that disconnecting a YouTube channel (social/connections) can call it
// without importing the service, which already reaches social/connections through actor and spaces/members.

// Why a connection is broken when only the server's key can't open its token: Google's access stands, and it mends
// itself once the key is right (social/connections).
export const KEY_REASON = "key";

// Deletes every reference the space's style added from its connected YouTube channel, with what YouTube said about
// each. Called when the channel is disconnected, Google ends EasyEdit's access to it, or another may have taken its
// place: YouTube's data is kept only while EasyEdit may read the channel it came from. Links people pasted themselves
// stay. No role check: the caller made the change.
export async function dropChannelReferences(db: DB, spaceId: string): Promise<void> {
  await db.delete(styleReference).where(and(eq(styleReference.spaceId, spaceId), eq(styleReference.provider, "channel")));
}

// Deletes one reference added from the space's channel, when it was kept after the channel went (it was being added
// as the channel was disconnected or replaced). Nothing happens when it is gone already.
export async function dropChannelReference(db: DB, spaceId: string, id: string): Promise<void> {
  await db.delete(styleReference).where(and(eq(styleReference.id, id), eq(styleReference.spaceId, spaceId), eq(styleReference.provider, "channel")));
}

// The daily clean-up's sweep: in every space, the references from a YouTube channel the space no longer has (none is
// connected, or Google ended EasyEdit's access to the one it has) are deleted. They should have gone when the channel
// did; this catches any a moment's overlap left behind. Answers how many were deleted. No role check: it is nobody's
// change.
export async function dropUnconnectedChannelReferences(db: DB): Promise<number> {
  const working = db
    .select({ id: socialConnection.id })
    .from(socialConnection)
    .where(
      and(
        eq(socialConnection.spaceId, styleReference.spaceId),
        eq(socialConnection.platform, "youtube"),
        or(isNull(socialConnection.brokenAt), eq(socialConnection.brokenReason, KEY_REASON)),
      ),
    );
  const dropped = await db
    .delete(styleReference)
    .where(and(eq(styleReference.provider, "channel"), not(exists(working))))
    .returning({ id: styleReference.id });
  return dropped.length;
}
