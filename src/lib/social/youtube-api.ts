import "server-only";
import { DriveError, reach, refusalReason } from "@/lib/drive/token";
import { LIMITS } from "@/lib/limits";
import type { ChannelVideo } from "@/lib/style/service";
import { ANALYSIS_LIMITS, thumbnailAddress } from "@/lib/style/types";
import { withSuffix } from "@/lib/text";
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

// One of the channel's uploads, as the Style page offers it: what YouTube says about it, and its id.
export type ChannelUpload = ChannelVideo & { id: string };

// The most uploads one listing asks for: what YouTube answers in one page.
const UPLOADS_PAGE = 50;

// Words from YouTube on one line: control characters and direction overrides out, at most max characters with "…"
// when longer. undefined when nothing is left.
function oneLine(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = value
    .toWellFormed()
    .replace(/[\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
  if (line === "") return undefined;
  return line.length <= max ? line : withSuffix(line, "…", max);
}

const DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

// A video's length as YouTube writes it (ISO 8601: "PT1M5S", "PT2H", "P1DT3M4S") in seconds. undefined for anything
// else, and for no length at all (a live stream's "P0D").
export function durationSeconds(value: unknown): number | undefined {
  if (typeof value !== "string" || value === "P" || value.endsWith("T")) return undefined;
  const parts = DURATION.exec(value);
  if (!parts) return undefined;
  const [days, hours, minutes, seconds] = parts.slice(1).map((part) => Number(part ?? 0));
  const total = days * 86_400 + hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

// A video's picture: its medium one (320 by 180), else its high one (480 by 360), and only from the image servers a
// style may show pictures from.
function thumbnailOf(thumbnails: unknown): string | undefined {
  if (!isRecord(thumbnails)) return undefined;
  for (const size of ["medium", "high"]) {
    const picture = thumbnails[size];
    const address = isRecord(picture) ? thumbnailAddress(picture.url) : null;
    if (address !== null) return address;
  }
  return undefined;
}

// Whether YouTube's answer says anyone may find and watch the video. The channel's own token is also shown its
// private and unlisted videos (drafts, videos not out yet), which never go further than YouTube shows them: a video
// whose answer doesn't say it is public is left out.
const isPublic = (item: Record<string, unknown>) => isRecord(item.status) && item.status.privacyStatus === "public";

// One public video from YouTube's answer, with the channel it is on. null when it isn't one: no id, no title, or not
// public.
function videoOf(item: unknown): { upload: ChannelUpload; channelId: string | null } | null {
  if (!isRecord(item) || !isVideoId(item.id) || !isRecord(item.snippet) || !isPublic(item)) return null;
  const { snippet } = item;
  const title = oneLine(snippet.title, LIMITS.socialTitleChars);
  if (title === undefined) return null;
  const author = oneLine(snippet.channelTitle, LIMITS.styleShortTextChars);
  const thumbnailUrl = thumbnailOf(snippet.thumbnails);
  const seconds = durationSeconds(isRecord(item.contentDetails) ? item.contentDetails.duration : undefined);
  const description = oneLine(snippet.description, ANALYSIS_LIMITS.descriptionChars);
  const tags = (Array.isArray(snippet.tags) ? snippet.tags : []).flatMap((tag) => oneLine(tag, ANALYSIS_LIMITS.tagChars) ?? []).slice(0, ANALYSIS_LIMITS.tags);
  const upload: ChannelUpload = {
    id: item.id,
    // YouTube's answer doesn't say whether a video is a Short, so every one goes by its watch page.
    url: `https://www.youtube.com/watch?v=${item.id}`,
    title,
    ...(author !== undefined && { author }),
    ...(thumbnailUrl !== undefined && { thumbnailUrl }),
    ...(seconds !== undefined && { seconds }),
    ...(description !== undefined && { description }),
    ...(tags.length > 0 && { tags }),
  };
  const channelId = typeof snippet.channelId === "string" && snippet.channelId !== "" ? snippet.channelId : null;
  return { upload, channelId };
}

// The public videos among these ids (at most 50, already checked), as the token sees them, by id. A video YouTube
// doesn't show it, or one that isn't public, is left out.
async function videosById(accessToken: string, ids: string[], fetchFn: typeof fetch): Promise<Map<string, { upload: ChannelUpload; channelId: string | null }>> {
  const answer = await reach(fetchFn, "youtube_video", `${API}/youtube/v3/videos?part=snippet,contentDetails,status&id=${ids.join(",")}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!answer.ok) throw await refused("youtube_video", answer);
  const { items } = await objectIn(answer);
  const found = new Map<string, { upload: ChannelUpload; channelId: string | null }>();
  for (const item of Array.isArray(items) ? items : []) {
    const video = videoOf(item);
    if (video) found.set(video.upload.id, video);
  }
  return found;
}

// The id of the video a playlist item is.
function playlistVideoId(item: unknown): unknown {
  if (!isRecord(item)) return undefined;
  if (isRecord(item.contentDetails) && item.contentDetails.videoId !== undefined) return item.contentDetails.videoId;
  return isRecord(item.snippet) && isRecord(item.snippet.resourceId) ? item.snippet.resourceId.videoId : undefined;
}

// The newest public uploads of the channel the token speaks for, newest first, at most max (and at most 50): each
// one's title, channel name, picture, length, description and tags, read with the channel's permission to view it.
// Only that channel's own videos, and only public ones, picked from its 50 newest uploads, so private and unlisted
// ones don't crowd them out. Empty when the account has no channel or the channel has no public uploads.
export async function listMyUploads(accessToken: string, fetchFn: typeof fetch = fetch, max = 25): Promise<ChannelUpload[]> {
  const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
  const channel = await reach(fetchFn, "youtube_channel", `${API}/youtube/v3/channels?part=contentDetails&mine=true&maxResults=1`, auth);
  if (!channel.ok) throw await refused("youtube_channel", channel);
  const { items } = await objectIn(channel);
  const first: unknown = Array.isArray(items) ? items[0] : undefined;
  if (!isRecord(first) || !isRecord(first.contentDetails) || !isRecord(first.contentDetails.relatedPlaylists)) return [];
  const playlistId = first.contentDetails.relatedPlaylists.uploads;
  if (typeof playlistId !== "string" || playlistId === "") return [];

  const count = Math.min(Math.max(Math.trunc(max), 1), UPLOADS_PAGE) || 1;
  const listed = await reach(
    fetchFn,
    "youtube_playlist",
    `${API}/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(playlistId)}&maxResults=${UPLOADS_PAGE}`,
    auth,
  );
  if (!listed.ok) {
    const failure = await refused("youtube_playlist", listed);
    // A channel with no uploads yet may have no uploads list at all.
    if (failure.status === 404 && failure.reason === "playlistNotFound") return [];
    throw failure;
  }
  const playlist = (await objectIn(listed)).items;
  const ids = [...new Set((Array.isArray(playlist) ? playlist : []).map(playlistVideoId).filter(isVideoId))].slice(0, UPLOADS_PAGE);
  if (ids.length === 0) return [];

  const found = await videosById(accessToken, ids, fetchFn);
  const channelId = typeof first.id === "string" && first.id !== "" ? first.id : null;
  return ids
    .flatMap((id) => {
      const video = found.get(id);
      return video && (channelId === null || video.channelId === channelId) ? [video.upload] : [];
    })
    .slice(0, count);
}

// One public video as YouTube shows it to the channel's token, described as listMyUploads describes an upload, with
// the channel it is on. null when YouTube shows no such video to it, when it isn't public, or when the id isn't a
// YouTube video's.
export async function channelVideo(accessToken: string, videoId: string, fetchFn: typeof fetch = fetch): Promise<(ChannelUpload & { channelId: string }) | null> {
  if (!isVideoId(videoId)) return null;
  const video = (await videosById(accessToken, [videoId], fetchFn)).get(videoId);
  return video && video.channelId !== null ? { ...video.upload, channelId: video.channelId } : null;
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
