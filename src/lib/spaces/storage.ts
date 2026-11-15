import { type DriveClient } from "@/lib/drive/client";
import { getDrive } from "@/lib/drive";
import { SEED_TEAM_ID } from "./types";

// The Drive client for a space's media. Only the Seattle Solvers team has a Drive folder in this stage.
export function driveFor(spaceId: string): DriveClient | null {
  return spaceId === SEED_TEAM_ID ? getDrive() : null;
}
