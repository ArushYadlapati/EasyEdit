import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { DriveError } from "@/lib/drive/token";
import { ServiceError } from "@/lib/service-error";
import { ConnectionBrokenError } from "./google-oauth";
import { STORAGE_MESSAGES } from "./messages";
import type { SetUpStorage } from "./setup";

export type StorageFormState = { error?: string };

export type StorageActionDeps = {
  db: () => DB;
  requireUser: () => Promise<CurrentUser>;
  setUp: SetUpStorage;
  revalidate: () => void; // the pages that show the space's storage
};

// What a refused or failed setup tells the person. Anything else is a fault and is thrown on.
function refusalOf(error: unknown): string | null {
  if (error instanceof ServiceError) {
    if (error.code === "STORAGE_IN_USE") return error.message;
    if (error.code === "TEAM_STORAGE_NOT_CONFIGURED") return STORAGE_MESSAGES.teamNotSetUp;
    if (error.code === "READER_LIMIT") return STORAGE_MESSAGES.readerLimit;
    if (error.code === "CONFLICT") return STORAGE_MESSAGES.serverNotSetUp;
    return STORAGE_MESSAGES.failed; // a space or connection that isn't theirs reads like any failure
  }
  if (error instanceof ConnectionBrokenError) return STORAGE_MESSAGES.connectionEnded;
  if (error instanceof DriveError) return STORAGE_MESSAGES.failed;
  return null;
}

export function makeStorageActions(deps: StorageActionDeps) {
  return {
    // "Use <email>": the space's storage in a Google account the person connected before, with no new Google screen.
    // setUp checks that they run the space and that the connection is theirs.
    async choose(spaceId: string, formData: FormData): Promise<StorageFormState> {
      const user = await deps.requireUser();
      const connectionId = formData.get("connectionId");
      if (typeof connectionId !== "string" || connectionId === "") return { error: STORAGE_MESSAGES.failed };
      try {
        await deps.setUp(deps.db(), { spaceId, connectionId, byUserId: user.id });
      } catch (error) {
        const message = refusalOf(error);
        if (message === null) throw error;
        console.error("Setting up storage failed:", error instanceof Error ? error.message : "unknown");
        if (error instanceof ConnectionBrokenError) deps.revalidate(); // the page then shows it as needing Google again
        return { error: message };
      }
      deps.revalidate();
      return {};
    },
  };
}
