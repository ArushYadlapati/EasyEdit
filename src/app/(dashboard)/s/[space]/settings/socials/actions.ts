"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { socialConfig } from "@/lib/social/config";
import { disconnectYoutube } from "@/lib/social/connections";
import { makeSocialActions, type SocialFormState } from "@/lib/social/social-actions";

const actions = makeSocialActions({
  db: getDb,
  requireUser: () => requireUser(),
  disconnect: (db, input) => disconnectYoutube(db, socialConfig(), input),
  revalidate: () => revalidatePath("/s", "layout"),
});

// Disconnect on the Socials settings page; the page binds the space.
export async function disconnectYoutubeAction(spaceId: string): Promise<SocialFormState> {
  return actions.disconnect(spaceId);
}
