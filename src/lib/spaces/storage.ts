import "server-only";
import { type DriveClient } from "@/lib/drive/client";
import { getDrive } from "@/lib/drive";
import { SEED_TEAM_ID } from "./types";

// The Drive client for a space's media. Only the Seattle Solvers team has a Drive folder in this stage.
export function driveFor(spaceId: string): DriveClient | null {
  return spaceId === SEED_TEAM_ID ? getDrive() : null;
}

// Whether a space has storage to upload to. Settings that cannot be read (a key that is not base64) count as not
// set up, with one line saying only that; nothing of the key is logged. The one rule for every caller that asks.
// lookup: how the space's Drive is found; the handlers pass their own.
export function hasStorage(spaceId: string, lookup: (spaceId: string) => DriveClient | null = driveFor): boolean {
  try {
    return lookup(spaceId) !== null;
  } catch {
    console.error("Drive settings could not be read");
    return false;
  }
}
