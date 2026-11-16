"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { markTutorialSeen } from "@/lib/tutorial/seen";

// Remembers that the signed-in person has been shown the intro tutorial, whatever their role. The dashboard's frame
// told the browser they had not seen it; it is drawn afresh, so a page the browser kept from before (going back from
// the editor, say) does not welcome them a second time. The open dialog stays as it is.
export async function markTutorialSeenAction(): Promise<{ error?: string }> {
  const me = await requireUser();
  await markTutorialSeen(getDb(), me.id);
  revalidatePath("/", "layout");
  return {};
}
