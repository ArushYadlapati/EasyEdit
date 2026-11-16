import "server-only";
import { mainServiceAccount } from "@/lib/drive";
import { deleteReader } from "@/lib/drive/reader";
import { storageConfig } from "./config";

// Removes a team's reader account with the app's service account. Skipped when storage isn't set up on this server
// (there can be no reader then); a failure comes out as an error, which the caller logs and carries on from.
export async function removeTeamReader(email: string): Promise<void> {
  const projectId = storageConfig()?.projectId;
  const caller = mainServiceAccount();
  if (!projectId || !caller) return;
  await deleteReader({ caller, projectId, email });
}
