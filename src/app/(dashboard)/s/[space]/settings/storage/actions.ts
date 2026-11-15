"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { setUpStorage } from "@/lib/storage/setup";
import { makeStorageActions, type StorageFormState } from "@/lib/storage/storage-actions";

const actions = makeStorageActions({
  db: getDb,
  requireUser: () => requireUser(),
  setUp: setUpStorage,
  revalidate: () => revalidatePath("/s", "layout"),
});

// "Use <email>" on the storage settings page; the page binds the space.
export async function chooseConnectionAction(spaceId: string, formData: FormData): Promise<StorageFormState> {
  return actions.choose(spaceId, formData);
}
