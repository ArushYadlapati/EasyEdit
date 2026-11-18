import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { ServiceError } from "@/lib/service-error";
import { SOCIAL_MESSAGES } from "./messages";

export type SocialFormState = { error?: string };

export type SocialActionDeps = {
  db: () => DB;
  requireUser: () => Promise<CurrentUser>;
  disconnect: (db: DB, input: { spaceId: string; byUserId: string }) => Promise<void>;
  revalidate: () => void; // the pages that show the space's channel
};

export function makeSocialActions(deps: SocialActionDeps) {
  return {
    // Disconnect: the space's channel goes. The service checks that the person runs the space.
    async disconnect(spaceId: string): Promise<SocialFormState> {
      const user = await deps.requireUser();
      try {
        await deps.disconnect(deps.db(), { spaceId, byUserId: user.id });
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error;
        deps.revalidate(); // a refusal often means the page is out of date
        return { error: error.code === "NOT_CONNECTED" ? error.message : SOCIAL_MESSAGES.disconnectFailed };
      }
      deps.revalidate();
      return {};
    },
  };
}
