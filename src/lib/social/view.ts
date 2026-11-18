import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import { LIMITS } from "@/lib/limits";
import { slugFor } from "@/lib/spaces/paths";
import type { MySpace, Space } from "@/lib/spaces/types";
import type { SocialConfig } from "./config";
import { findConnection } from "./connections";
import { listPosts, type PostListItem } from "./posts";

// What the Socials settings page shows: the space's channel and its latest posts. Only what the page needs; nothing
// secret, so it can go to the browser.
export type SocialsSettingsView = {
  space: Space; // its slug as addresses use it ("personal" for a personal space)
  youtube: {
    name: string; // the channel's name, or the Google account's address when the name is not known
    email: string | null; // the Google account's, when the name above is the channel's
    connectedBy: string | null; // the name of the person who connected it, when they still have an account
    broken: boolean;
  } | null;
  posts: (Omit<PostListItem, "createdAt"> & { createdAt: string })[]; // newest first; dates as ISO text
  postsPerDay: number;
};

// The caller has checked that the viewer is the space's admin.
export async function socialsSettings(db: DB, cfg: SocialConfig | null, space: MySpace): Promise<SocialsSettingsView> {
  const connection = await findConnection(db, cfg, space.id);
  const [by] = connection ? await db.select({ name: user.name }).from(user).where(eq(user.id, connection.connectedBy)) : [];
  const posts = await listPosts(db, space.id);
  return {
    space: { id: space.id, slug: slugFor(space), name: space.name, kind: space.kind },
    youtube: connection
      ? {
          name: connection.channelTitle ?? connection.email,
          email: connection.channelTitle ? connection.email : null,
          connectedBy: by?.name ?? null,
          broken: connection.broken,
        }
      : null,
    posts: posts.map((post) => ({ ...post, createdAt: post.createdAt.toISOString() })),
    postsPerDay: LIMITS.socialPostsPerSpacePerDay,
  };
}
