import "server-only";
import type { DB } from "@/db";
import { storageBlock } from "@/lib/storage/availability";
import { storageState } from "@/lib/spaces/storage";
import { listMySpaces } from "@/lib/spaces/service";
import { personalSpaceId, type MySpace } from "@/lib/spaces/types";

export type WelcomeStep = "storage" | "agents";

export type WelcomePlan = {
  steps: WelcomeStep[];
  // The team the person arrived to join, when `team` names one they are a member of; anything else is ignored.
  team: MySpace | null;
};

// The steps a new account sees. Invited to a team (a member of it): AI agents only. Otherwise storage first, when
// Personal spaces are open, storage is set up on this server and the Personal space has none yet; then AI agents.
export async function welcomePlan(db: DB, userId: string, teamSlug: string | undefined): Promise<WelcomePlan> {
  const team = teamSlug ? ((await listMySpaces(db, userId)).find((s) => s.kind === "team" && s.slug === teamSlug) ?? null) : null;
  if (team) return { steps: ["agents"], team };
  const offerStorage =
    storageBlock("personal") === null && (await storageState(db, personalSpaceId(userId)).catch(() => null))?.ready === false;
  return { steps: offerStorage ? ["storage", "agents"] : ["agents"], team: null };
}
