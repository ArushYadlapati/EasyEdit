import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { StorageSettings } from "@/components/storage/storage-settings";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { findMySpace } from "@/lib/spaces/service";
import { storageSettings } from "@/lib/storage/settings-view";
import { chooseConnectionAction } from "./actions";

// Where a space keeps its videos, and the ways to change it, for its admins (a personal space's owner is one).
// Anyone else gets a plain 404. ?storage=<note> is what connecting a Google account came back with; ?first=1, a team
// just made. The page checks for itself: a layout is not run again on a client navigation.
export default async function StorageSettingsPage({ params, searchParams }: PageProps<"/s/[space]/settings/storage">): Promise<ReactNode> {
  const user = await requireUser();
  const db = getDb();
  const space = await findMySpace(db, user.id, (await params).space);
  if (!space || space.role !== "admin") notFound();
  const view = await storageSettings(db, space, user.id);
  const { storage, first } = await searchParams;
  const note = (Array.isArray(storage) ? storage[0] : storage) ?? null;

  return <StorageSettings view={view} note={note} first={first === "1"} choose={chooseConnectionAction.bind(null, space.id)} />;
}
