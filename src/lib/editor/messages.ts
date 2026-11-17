import type { OpErrorCode } from "@/lib/timeline";
import type { SyncStatus } from "./types";

export const MESSAGES = {
  undoRefused: "Can't undo. This was changed afterwards.",
  redoRefused: "Can't redo. This was changed afterwards.",
  rebaseDropped: "A change of yours no longer fits and was removed.",
  clipGone: "That clip was removed by someone else.",
  trackGone: "That track was removed by someone else.",
  guideGone: "That guide was removed by someone else.",
  tooManyOps: "That's too many changes at once.",
  readOnly: "You have view-only access.",
  lostAccess: "You no longer have edit access.",
  signedOut: "You're signed out. Sign in again to save your changes.",
  nothingToSplit: "Nothing to split at the playhead.",
  nothingToPaste: "Nothing to paste.",
  noRoom: "No room here, and the project can't take more tracks.",
  selectTextToRecolor: "Select a text clip to recolor it.",
  mediaNotReady: "This file isn't ready yet.",
  renameFailed: "Couldn't rename the project. Try again.",
  cropHint: "Drag a handle to crop. Next time, you can hold Ctrl while you drag.",
  cropHintMac: "Drag a handle to crop. Next time, you can hold Control while you drag.",
  trackHidden: "That track is hidden.",
  alsoHere: "Also here", // the group of teammates' dots in the top bar
  you: "You", // your own dot in that group
  someone: "Someone", // a teammate whose name is empty
  nothingSelected: "nothing selected",
} as const;

// What a teammate has selected, as the top bar says it: "2 clips selected", "Text 1 track selected".
export function clipsSelected(n: number): string {
  return n === 1 ? "1 clip selected" : `${n} clips selected`;
}

export function trackSelected(trackName: string): string {
  return `${trackName} track selected`;
}

// A teammate's dot that moves your playhead to what they selected.
export function goToSelection(name: string, clips: number): string {
  return `Go to ${name}'s selection (${clips === 1 ? "1 clip" : `${clips} clips`})`;
}

// A teammate's dot with nowhere to go: "Grace Hopper, Text 1 track selected".
export function peerStatus(name: string, summary: string): string {
  return `${name}, ${summary}`;
}

const OP_ERROR_MESSAGES: Record<OpErrorCode, string> = {
  OVERLAP: "There's another clip in the way.",
  TRACK_LOCKED: "That track is locked.",
  WRONG_TRACK_KIND: "That clip can't go on this track.",
  TRIM_OUT_OF_RANGE: "The clip can't be trimmed that far.",
  NOT_FOUND: "That clip or track no longer exists.",
  LIMIT_EXCEEDED: "This project has reached a size limit.",
  STALE: MESSAGES.undoRefused,
  INVALID: "That change couldn't be made.",
  DUPLICATE_ID: "That change couldn't be made.",
};

export function explainOpError(code: OpErrorCode): string {
  return OP_ERROR_MESSAGES[code] ?? OP_ERROR_MESSAGES.INVALID;
}

// The top bar's save status. A viewer has nothing to save, so "Saved" reads as "Up to date".
export function saveStatusLabel(status: SyncStatus, pending: number, canEdit: boolean, limitMessage?: string | null): string {
  switch (status) {
    case "saved":
      return canEdit ? "Saved" : "Up to date";
    case "saving":
      return "Saving…";
    case "offline":
      return pending > 0 ? "Offline. Changes will save when you reconnect." : "Offline";
    case "limited":
      return limitMessage ?? "Changes are waiting to save."; // the server's own sentence
    case "signed-out":
      return "Signed out";
    case "deleted":
      return "Deleted";
  }
}
