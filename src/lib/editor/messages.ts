import type { OpErrorCode } from "@/lib/timeline";
import type { SyncStatus } from "./types";

export const MESSAGES = {
  undoRefused: "Can't undo. This was changed afterwards.",
  redoRefused: "Can't redo. This was changed afterwards.",
  rebaseDropped: "A change of yours no longer fits and was removed.",
  // The same, when one person's change (a teammate's or an AI agent's) is why.
  rebaseDroppedBy: (who: string, clipRemoved: boolean) =>
    clipRemoved
      ? `${who} removed the clip you were changing, so your change was dropped. Undo theirs in Activity to get the clip back.`
      : `${who} changed this first, so your change no longer fit and was dropped. Their change is in Activity.`,
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
  selectTextToRecolor: "Select a text clip or a shape to recolor it.",
  selectSoundClip: "Select a video or audio clip to change its volume.",
  leveled: (clips: number) => (clips === 1 ? "Volume leveled." : `Leveled ${clips} clips.`),
  alreadyLevel: (clips: number) => (clips === 1 ? "This clip is already level." : "These clips are already level."),
  levelSilent: "No sound to measure there.",
  levelUnreadable: "Couldn't read the sound of that file.",
  nothingToSeparate: "Select a video clip that has sound to separate its audio.",
  nothingToGroup: "Select two or more clips on unlocked tracks to link them.",
  nothingToUngroup: "None of the selected clips is linked.",
  reframeRefused: {
    "not-a-video": "Reframing is for a video clip.",
    fits: "This clip already has the frame's shape: there is nothing to reframe.",
    turned: "A clip that is turned or flipped can't be reframed. Set its rotation to 0 first.",
    backwards: "A clip that plays backwards or is frozen can't be reframed.",
    "too-long": "This clip is too long to reframe at once (five minutes at most). Cut it and reframe each part.",
    "no-size": "Couldn't tell this video's size to reframe it.",
  },
  reframeUnreadable: "Couldn't read that video to reframe it.",
  reframeStill: "Nothing moves in this clip, so there is nothing to follow. It was left as it is.",
  reframed: "Reframed: the clip fills the frame and follows the movement. Its position keyframes are in the Effects tab.",
  cutoutUnreadable: "Couldn't read that picture to remove its background.",
  cutoutModel: "Couldn't get the model that removes backgrounds. Check your connection and try again.",
  cutoutNothing: "Found no one in that picture. This works on people; nothing was changed.",
  cutoutFailed: "Couldn't remove the background of that picture.",
  cutoutNoStorage: "The cut-out couldn't be saved: this space isn't taking uploads.",
  cutoutUploadFailed: "The cut-out couldn't be uploaded. Nothing was changed.",
  cutoutInLibrary: "The cut-out is in the Media tab. The clip changed while it was made, so it was left as it is.",
  cutoutDone: "Background removed. The first picture is still in the Media tab, and Undo brings it back.",
  angleRefused: {
    "one-angle": "Select videos on two or more tracks to cut between them.",
    locked: "One of those cameras is on a locked track.",
    "nothing-here": "That camera has no footage at the playhead.",
    already: "That camera is already the one showing here.",
  },
  steadyTooLong: "That clip is too long to stabilize at once: split it into parts of five minutes or less.",
  steadyUnreadable: "Couldn't read that video to stabilize it.",
  steadyUnsure: "Couldn't make out how the camera moved in this clip: too much of the picture is flat or dark. Nothing was changed.",
  steadyAlready: "This clip is steady already: there was no shake to take out.",
  steadied: (zoom: number) => `Stabilized. The picture is drawn ${Math.round((zoom - 1) * 100)}% larger so its edges never show.`,
  followRefused: {
    "not-a-follower": "Select one text, shape or image, with the playhead on it, to make it follow something.",
    "no-video": "There's no video under it at the playhead to follow.",
    turned: "The video under it is rotated, flipped or moved by keyframes, so nothing in it can be followed yet.",
    "too-long": "That is more than 30 seconds to follow. Trim the clip to the part where it should follow.",
  },
  followUnreadable: "Couldn't read that video to follow it.",
  followLost: "Couldn't follow anything there. Put the clip on something with clear edges or a pattern, and try again.",
  followed: "It now follows what was under it. Its position keyframes are in the Effects tab.",
  followedPart: (seconds: number) => `It follows what was under it for ${seconds.toFixed(1)} s, then loses it. Its position keyframes are in the Effects tab.`,
  nestRefused: {
    nothing: "Select the clips to nest.",
    slot: "An empty slot can't be nested: a template fills it by its name.",
    nest: "A nest can't go inside a nest. Unnest it first.",
    locked: "One of those clips is on a locked track.",
    "too-many": "That is more clips than one nest holds.",
    "no-room": "There's no room for another track to put the nest on.",
  },
  unnestRefused: {
    "not-a-nest": "Select one nest to take it apart.",
    locked: "That nest is on a locked track.",
    "no-room": "There's no room for the tracks its clips need.",
  },
  scenesUnreadable: "Couldn't read that video to look for its cuts.",
  oneScene: "No cuts found: this clip looks like one shot.",
  scenesSplit: (shots: number) => `Split into ${shots} shots.`,
  syncNeedsTwo: "Select two or more video or audio clips that play at normal speed to line them up by their sound.",
  syncUnreadable: "Couldn't read the sound of the clip the others would line up with.",
  syncNoMatch: "Couldn't find the same sound in those clips. They may not be recordings of the same moment, or may be too short to tell: a few seconds are needed.",
  alreadySynced: "Those clips already line up.",
  synced: (moved: number, unmatched: number) =>
    `${moved === 1 ? "Moved 1 clip" : `Moved ${moved} clips`} to line up by sound.${unmatched === 0 ? "" : unmatched === 1 ? " 1 clip had no matching sound and stayed." : ` ${unmatched} clips had no matching sound and stayed.`}`,
  rampNeedsOne: "Select one video or audio clip to ramp its speed.",
  rampRefused: {
    "not-a-clip": "A speed ramp needs a video or audio clip that plays forward, on an unlocked track.",
    "too-short": "That clip is too short to ramp: it needs a few frames for each change of speed.",
    "no-room": "That track holds as many clips as it can. A speed ramp cuts a clip into several.",
  },
  noRoomForLayer: "This project has as many tracks as it can hold. Remove one, or clear room on the top video track, to add an adjustment layer.",
  lutTooLarge: "That file is too large to read as a look-up table.",
  lutsFull: "This project already keeps as many LUTs as it can. Remove one from the project first.",
  nothingToClean: "Select a video or audio clip to clean up its sound.",
  cleanedUp: (clips: number) => (clips === 1 ? "Cleaned up the voice." : `Cleaned up ${clips} clips.`),
  nothingToDuck: "Select the music or sound to turn down under speech.",
  nothingOver: "Nothing else is heard over that clip, so there is nothing to duck under.",
  ducked: (clips: number) => (clips === 1 ? "Ducked under the other sound." : `Ducked ${clips} clips under the other sound.`),
  nothingToReverse: "Select a video clip to play it backward.",
  nothingToFreeze: "Select a video clip and put the playhead on the frame to freeze.",
  slotShort: (slot: string) => `${slot}: the clip is shorter than the slot, so there's a gap after it.`,
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
// held: a live edit is on screen and not sent yet (held-edit.ts), so "Saved" would not be true. online: the browser
// says it is connected, so a save that fails is EasyEdit not answering, not the person's own connection.
export function saveStatusLabel(
  status: SyncStatus,
  pending: number,
  canEdit: boolean,
  limitMessage?: string | null,
  held = false,
  online = false,
): string {
  switch (status) {
    case "saved":
      if (held && canEdit) return "Not saved yet";
      return canEdit ? "Saved" : "Up to date";
    case "saving":
      return "Saving…";
    case "offline":
      if (online) return pending > 0 ? "Can't reach EasyEdit. Your changes are kept here and will save when it answers." : "Can't reach EasyEdit";
      return pending > 0 ? "Offline. Changes will save when you reconnect." : "Offline";
    case "limited":
      return limitMessage ?? "Changes are waiting to save."; // the server's own sentence
    case "signed-out":
      return "Signed out";
    case "deleted":
      return "Deleted";
  }
}
