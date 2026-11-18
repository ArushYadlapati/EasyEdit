import "server-only";
import { DriveError, reach, refusalReason } from "@/lib/drive/token";
import { isVideoId, type Visibility } from "./rules";

// The calls EasyEdit makes to YouTube, all from the server. A failed one becomes a DriveError (what every failed
// Google call becomes): which call, the status and Google's short code, never the answer or an address.

export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

const API = "https://www.googleapis.com";
const JSON_TYPE = "application/json; charset=UTF-8";
// What a session that is gone answers (the same upload protocol as Drive's).
const DEAD_SESSION = [404, 410, 499];

export type Channel = { id: string; title: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function objectIn(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  return isRecord(body) ? body : {};
}

const refused = async (call: string, response: Response) => new DriveError(call, response.status, await refusalReason(response));

// The channel the token speaks for (the one the person picked on Google's screen). null: the account has no channel.
export async function myChannel(accessToken: string, fetchFn: typeof fetch = fetch): Promise<Channel | null> {
  const answer = await reach(fetchFn, "youtube_channel", `${API}/youtube/v3/channels?part=snippet&mine=true&maxResults=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!answer.ok) throw await refused("youtube_channel", answer);
  const { items } = await objectIn(answer);
  const first: unknown = Array.isArray(items) ? items[0] : undefined;
  if (!isRecord(first)) return null;
  const title = isRecord(first.snippet) ? first.snippet.title : undefined;
  if (typeof first.id !== "string" || first.id === "" || typeof title !== "string") throw new DriveError("youtube_channel", answer.status, "unknown");
  return { id: first.id, title };
}

// The channel a video is on, as the channel's own token sees it. null when YouTube shows no such video to it.
export async function videoChannel(accessToken: string, videoId: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const answer = await reach(fetchFn, "youtube_video", `${API}/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!answer.ok) throw await refused("youtube_video", answer);
  const { items } = await objectIn(answer);
  const first: unknown = Array.isArray(items) ? items[0] : undefined;
  const channelId = isRecord(first) && isRecord(first.snippet) ? first.snippet.channelId : undefined;
  return typeof channelId === "string" && channelId !== "" ? channelId : null;
}

// An upload address is handed to a browser and called again by this server, so it must be Google's and nothing else.
export function isUploadAddress(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && (url.hostname === "googleapis.com" || url.hostname.endsWith(".googleapis.com")) && url.username === "" && url.password === "";
}

export type VideoUpload = { title: string; description: string; visibility: Visibility; madeForKids: boolean; sizeBytes: number; origin: string };

// Opens one video's upload on the channel, with what the video is called and who may see it already fixed. Returns
// the session address: whoever holds it can send that one file and nothing else. Without the page's origin here, the
// page could not read YouTube's answers to the pieces it sends.
export async function openVideoUpload(accessToken: string, input: VideoUpload, fetchFn: typeof fetch = fetch): Promise<string> {
  const answer = await reach(fetchFn, "youtube_session", `${API}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": JSON_TYPE,
      Origin: input.origin,
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(input.sizeBytes),
    },
    body: JSON.stringify({
      snippet: { title: input.title, description: input.description },
      status: { privacyStatus: input.visibility, selfDeclaredMadeForKids: input.madeForKids },
    }),
  });
  if (!answer.ok) throw await refused("youtube_session", answer);
  const address = answer.headers.get("location");
  if (!address || !isUploadAddress(address)) throw new DriveError("youtube_session", answer.status, "unknown");
  return address;
}

export type UploadState = { done: false; offset: number } | { done: true; videoId: string | null };

// How much of an upload YouTube holds. No token: the address is the permission. A finished upload answers with the
// video, whose id is read from YouTube's own answer.
export async function uploadState(sessionUrl: string, sizeBytes: number, fetchFn: typeof fetch = fetch): Promise<UploadState> {
  const answer = await reach(fetchFn, "youtube_upload", sessionUrl, { method: "PUT", headers: { "Content-Range": `bytes */${sizeBytes}` } });
  if (answer.status === 308) {
    const range = answer.headers.get("range");
    if (range === null) return { done: false, offset: 0 }; // nothing held yet
    const last = /^bytes=0-(\d+)$/.exec(range);
    if (!last) throw new DriveError("youtube_upload", answer.status, "unknown");
    return { done: false, offset: Number(last[1]) + 1 };
  }
  if (answer.status === 200 || answer.status === 201) {
    const { id } = await objectIn(answer);
    return { done: true, videoId: isVideoId(id) ? id : null };
  }
  if (DEAD_SESSION.includes(answer.status)) throw new DriveError("youtube_upload", answer.status, "expired");
  throw await refused("youtube_upload", answer);
}

// Ends an upload that will not be finished. One that is already gone is not an error.
export async function cancelUpload(sessionUrl: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const answer = await reach(fetchFn, "youtube_cancel", sessionUrl, { method: "DELETE" });
  if (!answer.ok && !DEAD_SESSION.includes(answer.status)) throw await refused("youtube_cancel", answer);
}
