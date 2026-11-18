// The sentences the Socials settings page and the post form show. No server code in here.

// What connecting a channel came back with (?youtube=<note> on the Socials settings page).
export type ConnectNote = "connected" | "cancelled" | "failed" | "expired" | "needs-upload" | "no-channel" | "not-configured";
// What the page itself adds after a disconnect.
export type SocialsNote = ConnectNote | "disconnected";

export const CONNECT_NOTES: Record<SocialsNote, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "YouTube channel connected." },
  cancelled: { tone: "error", text: "Connecting was canceled, so nothing changed." },
  failed: { tone: "error", text: "Google didn't finish connecting the channel. Try again." },
  expired: { tone: "error", text: "That took too long, so nothing changed. Try again." },
  "needs-upload": { tone: "error", text: "EasyEdit needs permission to upload videos to post them. Connect again and leave that box ticked." },
  "no-channel": { tone: "error", text: "That Google account has no YouTube channel yet. Create one on YouTube, then connect again." },
  "not-configured": { tone: "error", text: "Posting to YouTube isn't set up on this server." },
  disconnected: { tone: "ok", text: "YouTube channel disconnected. Videos already posted stay on YouTube." },
};

export const connectNote = (value: string | null): { tone: "ok" | "error"; text: string } | null =>
  value !== null && Object.hasOwn(CONNECT_NOTES, value) ? CONNECT_NOTES[value as SocialsNote] : null;

export const SOCIAL_MESSAGES = {
  notConnected: "This space has no YouTube channel connected.",
  broken: "EasyEdit lost its connection to the YouTube channel. An admin of this space needs to connect it again in Settings, Socials.",
  dayUsedUp: "This space has reached today's limit for posts (10). It frees up over the next 24 hours.",
  quota: "YouTube's daily limit for EasyEdit is used up. Try again tomorrow.",
  uploadLimit: "YouTube says this channel has uploaded too many videos today. Try again tomorrow.",
  noChannel: "The connected Google account has no YouTube channel. An admin needs to connect a channel in Settings, Socials.",
  refused: "YouTube refused the video. Check the title and description, then try again.",
  unreachable: "YouTube didn't answer. Try again.",
  expired: "The upload took too long and YouTube closed it. Post again.",
  notFinished: "YouTube doesn't have the whole video yet.",
  notAllowed: "YouTube didn't accept EasyEdit's connection to the channel. Try again, or ask an admin of this space to connect it again in Settings, Socials.",
  unconfirmed: "The video was sent to YouTube, but EasyEdit couldn't confirm it. Look on the channel before you post it again.",
  disconnectFailed: "Disconnecting didn't work. Try again.",
  // The post form in the editor.
  cantRead: "EasyEdit can't read the exported file any more. Export again to post it.",
  uploadStopped: "The upload to YouTube stopped. Check your connection, then post again.",
  postFailed: "Posting didn't work. Try again.",
  // The Socials settings page.
  intro: "Connect the YouTube channel this space posts to. After an export, anyone who can edit here can post the video to it. Nothing is posted until someone presses Post.",
  connect: "Connect a YouTube channel",
  connectAgain: "Connect again",
  useDifferent: "Use a different channel",
  disconnect: "Disconnect",
  disconnectQuestion: "People in this space won't be able to post to it until a channel is connected again. Videos already posted stay on YouTube.",
  brokenHere: "EasyEdit lost its connection to this channel. Connect it again to keep posting.",
  postsHeading: "Recent posts",
  noPosts: "Nothing has been posted from this space yet.",
} as const;

export const connectChannelHref = (spaceId: string) => `/api/social/youtube/connect?space=${encodeURIComponent(spaceId)}`;

export const POST_STATUS_LABELS = { uploading: "Uploading", posted: "Posted", failed: "Didn't finish", canceled: "Stopped" } as const;

// What a refused call to Google means to the person: by YouTube's short code, then by which call it was and its status.
export function refusalMessage(failure: { call: string; reason: string; status: number }): string {
  const { call, reason, status } = failure;
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") return SOCIAL_MESSAGES.quota;
  if (reason === "uploadLimitExceeded") return SOCIAL_MESSAGES.uploadLimit;
  if (reason === "youtubeSignupRequired") return SOCIAL_MESSAGES.noChannel;
  if (reason === "unreachable" || status >= 500) return SOCIAL_MESSAGES.unreachable;
  // The sign-in to the channel was refused (not ended: that is a broken connection), or YouTube said the token may not.
  if (call === "oauth" || status === 401 || status === 403) return SOCIAL_MESSAGES.notAllowed;
  return SOCIAL_MESSAGES.refused;
}

// Where a connect that can't name its space lands (a space's dashboard, by way of /dashboard?youtube=…).
const DASHBOARD_NOTES: Record<string, { text: string; problem: boolean }> = {
  refused: { text: "That link to connect a YouTube channel didn't work. Start again from the space's settings, under Socials.", problem: true },
  failed: { text: "Connecting the YouTube channel didn't work. Try again from the space's settings, under Socials.", problem: true },
  "not-configured": { text: "Posting to YouTube isn't set up on this server.", problem: true },
};
export function dashboardChannelNote(value: string | string[] | null | undefined): { text: string; problem: boolean } | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first && Object.hasOwn(DASHBOARD_NOTES, first) ? DASHBOARD_NOTES[first]! : null;
}
