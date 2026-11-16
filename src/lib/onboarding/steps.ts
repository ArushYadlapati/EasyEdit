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
  // The storage step is shown to say a connect just worked (Personal has storage now, and the page was told so).
  connected: boolean;
};

// The steps a new account sees. Invited to a team (a member of it): AI agents only. Otherwise storage first, when
// Personal spaces are open, storage is set up on this server and the Personal space has none yet; then AI agents.
// justConnected (the connect came back saying so): the storage step stays, to say it worked, if Personal really has
// storage now; a made-up note changes nothing.
export async function welcomePlan(
  db: DB,
  userId: string,
  teamSlug: string | undefined,
  { justConnected = false }: { justConnected?: boolean } = {},
): Promise<WelcomePlan> {
  const team = teamSlug ? ((await listMySpaces(db, userId)).find((s) => s.kind === "team" && s.slug === teamSlug) ?? null) : null;
  if (team) return { steps: ["agents"], team, connected: false };
  const ready = storageBlock("personal") === null ? (await storageState(db, personalSpaceId(userId)).catch(() => null))?.ready : undefined;
  const connected = justConnected && ready === true;
  const offerStorage = ready === false || connected;
  return { steps: offerStorage ? ["storage", "agents"] : ["agents"], team: null, connected };
}
