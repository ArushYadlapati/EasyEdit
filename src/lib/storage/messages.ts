import { MEDIA_MESSAGES } from "@/lib/media/messages";
import type { SpaceKind } from "@/lib/spaces/types";

// What stops this server connecting a Google account for a space: no storage settings at all ("server"), or none
// for team readers ("team": no Google Cloud project or app service account). null: nothing does.
export type StorageBlock = "server" | "team" | null;

// How much of a Google account's Drive is used, and its limit (null: the account has none).
export type DriveUsage = { usedBytes: number; limitBytes: number | null };

// The sentences of storage settings, the setup card and the reconnect banner.
export const STORAGE_MESSAGES = {
  sharedFolder: "Stored in the team's shared drive.",
  storedIn: (email: string) => `Stored in ${email}'s Google Drive`,
  folder: (name: string) => `Folder "${name}"`,
  brokenHere: "Google Drive needs reconnecting. Uploads are paused until you reconnect it.",
  moveLater: "Moving a space's videos to another account comes with team invites.",
  noneTeam: "This team has no storage yet.",
  noneYet: "No storage yet.",
  // A team just made, on a server where it can't have storage yet: the way on is its projects.
  readyWithoutStorage: "Your team is ready. You can add videos once storage is set up on this server.",
  toProjects: "Go to the team's projects",
  later: "Set this up later",
  // Only the person whose Google account it is can reconnect it: anyone else's sign-in would make a new connection.
  onlyOwner: (email: string | null) => (email ? `Only ${email} can reconnect it.` : "Only the person who connected it can reconnect it."),
  firstRun: "Choose where this team's videos are stored.",
  ownFolder: "EasyEdit keeps the videos in a folder of its own there, and can't see your other files.",
  serverNotSetUp: "Storage isn't set up on this server yet.",
  teamNotSetUp: "Team storage isn't set up on this server yet.",
  connect: "Connect Google Drive",
  reconnect: "Reconnect",
  useDifferent: "Use a different Google account",
  accountChoice: (email: string) => `Use ${email}`, // "Use <email>"
  chooseAccount: "Choose account",
  banner: "Google Drive needs reconnecting. Uploads are paused until an admin reconnects it.",
  // A choice of account that didn't go through.
  failed: "That didn't work. Nothing was changed. Try again.",
  // Google's own cap on service accounts for EasyEdit's project, hit while making a team's reader.
  readerLimit: "This team's storage couldn't be set up because EasyEdit has reached a Google limit. Try again later, or contact EasyEdit.",
  connectionEnded: "Google ended EasyEdit's access to that account. Choose it again to reconnect it.",
};

// The setup card's words for a space with no storage, or one whose connection broke.
export const SETUP_CARD = {
  personalTitle: "Set up your storage",
  personalText: "Pick a Google account for your own videos.",
  teamTitle: "Set up this team's storage",
  teamText: "Choose where this team's videos are stored.",
  noneTitle: "No storage yet",
  memberText: "An admin needs to choose where this team's videos are stored.",
};

export type Note = { text: string; problem: boolean };

// What the storage settings page says for ?storage=<note>, which the connect routes send back. Anything else: nothing.
const SETTINGS_NOTES: Record<string, Note> = {
  connected: { text: "Google Drive connected.", problem: false },
  "needs-drive": { text: "EasyEdit needs permission to its own files in your Drive. Try again and leave that box ticked.", problem: true },
  cancelled: { text: "Nothing was changed.", problem: false },
  failed: { text: STORAGE_MESSAGES.failed, problem: true },
  expired: { text: "That took too long, so nothing was changed. Try again.", problem: true },
  "not-configured": { text: STORAGE_MESSAGES.serverNotSetUp, problem: true },
  "reader-limit": { text: STORAGE_MESSAGES.readerLimit, problem: true },
  "in-use": { text: "This space already has videos in another Google account, so its storage can't be changed yet.", problem: true },
};

// The same for a space's dashboard, where a connect that can't name its space lands (by way of /dashboard).
const DASHBOARD_NOTES: Record<string, Note> = {
  refused: { text: "That link to connect Google Drive didn't work. Start again from storage settings.", problem: true },
  failed: { text: "Connecting Google Drive didn't work. Try again from storage settings.", problem: true },
};

const noteIn = (notes: Record<string, Note>, value: string | string[] | null | undefined): Note | null => {
  const first = Array.isArray(value) ? value[0] : value;
  return first && Object.hasOwn(notes, first) ? notes[first]! : null;
};
export const settingsNote = (value: string | string[] | null | undefined) => noteIn(SETTINGS_NOTES, value);
export const dashboardNote = (value: string | string[] | null | undefined) => noteIn(DASHBOARD_NOTES, value);

// note: a line in place of the action, for an admin who can't take it (someone else's connection).
export type StorageCard = { title: string; text: string; action: "choose" | "reconnect" | null; note: string | null };

// What a space without storage to upload to shows: in the Media tab, and at the top of its dashboard. A space whose
// connection broke says so, and its admins get Reconnect. One with none: its admins (a personal space's owner is one)
// get Choose account, unless this server can't set storage up, which everyone is told plainly. Reconnect is only for
// the admin whose connection it is (isOwner); another admin is told who can (ownerEmail, their account's address).
export function storageCard(input: {
  problem: "none" | "broken";
  kind: SpaceKind;
  isAdmin: boolean;
  block: StorageBlock;
  isOwner?: boolean;
  ownerEmail?: string | null;
}): StorageCard {
  const card = (title: string, text: string, action: StorageCard["action"] = null, note: string | null = null): StorageCard => ({ title, text, action, note });
  if (input.problem === "broken") {
    if (!input.isAdmin) return card(MEDIA_MESSAGES.brokenTitle, MEDIA_MESSAGES.broken);
    return input.isOwner === false
      ? card(MEDIA_MESSAGES.brokenTitle, MEDIA_MESSAGES.broken, null, STORAGE_MESSAGES.onlyOwner(input.ownerEmail ?? null))
      : card(MEDIA_MESSAGES.brokenTitle, MEDIA_MESSAGES.broken, "reconnect");
  }
  if (input.block !== null) return card(SETUP_CARD.noneTitle, input.block === "team" ? STORAGE_MESSAGES.teamNotSetUp : STORAGE_MESSAGES.serverNotSetUp);
  if (input.kind === "personal") return card(SETUP_CARD.personalTitle, SETUP_CARD.personalText, "choose");
  if (input.isAdmin) return card(SETUP_CARD.teamTitle, SETUP_CARD.teamText, "choose");
  return card(SETUP_CARD.noneTitle, SETUP_CARD.memberText);
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

// A size in Google's own units, as its storage page counts them (1024 bytes to a KB, so a free account's 15 GB is
// 15 × 1024³ bytes), with one decimal at most: 12.4 GB, 15 GB.
export function formatDriveBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Number(value.toFixed(1))} ${UNITS[unit]}`;
}

// "12.4 GB of 15 GB used", or "12.4 GB used" for an account with no limit.
export function usageLine(usage: DriveUsage): string {
  const used = formatDriveBytes(usage.usedBytes);
  return usage.limitBytes === null ? `${used} used` : `${used} of ${formatDriveBytes(usage.limitBytes)} used`;
}

// The address that starts connecting a Google account for the space; with `hint`, Google's screen offers that account.
export function connectHref(spaceId: string, hint?: string): string {
  const query = new URLSearchParams({ space: spaceId, ...(hint ? { hint } : {}) });
  return `/api/storage/connect?${query.toString()}`;
}

// A space's storage settings page.
export const storageSettingsPath = (slug: string) => `/s/${slug}/settings/storage`;
