import "server-only";
import { cache } from "react";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { listFolders } from "@/lib/projects/folders";
import { actorIn } from "@/lib/spaces/access";
import { findMySpace } from "@/lib/spaces/service";
import type { MySpace } from "@/lib/spaces/types";

// What a space's pages read about the space the address names, once per request: the page and its browser-tab title
// (generateMetadata) share the same reads instead of making them twice.

// The signed-in person's space with this slug ("personal" for their own), or null when they are not in it.
export const mySpace = cache(async (slug: string): Promise<MySpace | null> => {
  const user = await requireUser();
  return findMySpace(getDb(), user.id, slug);
});

// The person as they act in that space, or null.
export const myActor = cache(async (slug: string) => {
  const space = await mySpace(slug);
  return space ? actorIn(getDb(), await requireUser(), space.id) : null;
});

// The space's folders, or none when the person is not in it.
export const myFolders = cache(async (slug: string) => {
  const actor = await myActor(slug);
  return actor ? listFolders(getDb(), actor) : [];
});

// A space's name as its pages show it.
export const spaceLabel = (space: Pick<MySpace, "kind" | "name">): string => (space.kind === "personal" ? "Personal" : space.name);
