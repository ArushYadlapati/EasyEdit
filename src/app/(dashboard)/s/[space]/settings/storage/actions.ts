"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { disconnectStorage } from "@/lib/storage/disconnect";
import { setUpStorage } from "@/lib/storage/setup";
import { makeStorageActions, type StorageFormState } from "@/lib/storage/storage-actions";

const actions = makeStorageActions({
  db: getDb,
  requireUser: () => requireUser(),
  setUp: setUpStorage,
  disconnect: disconnectStorage,
  revalidate: () => revalidatePath("/s", "layout"),
});

// Disconnect on the storage settings page; the page binds the space.
export async function disconnectStorageAction(spaceId: string): Promise<StorageFormState> {
  return actions.disconnect(spaceId);
}
