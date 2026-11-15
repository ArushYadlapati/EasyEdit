import "server-only";
import { type DriveClient } from "@/lib/drive/client";
import { getDrive } from "@/lib/drive";
import { SEED_TEAM_ID } from "./types";

// Whether a space is meant to have storage, set up or not; no Drive call. Only the Seattle Solvers team has a Drive
// folder in this stage. A Drive that should work but is not set up is hasStorage's answer, not this one.
export function spaceHasStorage(spaceId: string): boolean {
  return spaceId === SEED_TEAM_ID;
}

// The Drive client for a space's media.
export function driveFor(spaceId: string): DriveClient | null {
  return spaceHasStorage(spaceId) ? getDrive() : null;
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
