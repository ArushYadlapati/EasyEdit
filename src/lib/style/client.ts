import { packBytes } from "@/lib/color/cube";
import type { ChannelUpload } from "@/lib/social/youtube-api";
import type { ChannelStatus } from "./channel";
import type { ReferenceSource, Style, StylePatch, StyleReference, VideoAnalysis } from "./types";

// The browser's calls to /api/style. A refusal throws with the server's own message, which is written for people;
// an answer of the wrong shape throws the call's own words, so a page that answers something else never reaches the
// Style page's drawing.

const LOAD_FAILED = "Your style couldn't be loaded. Try again.";
const SAVE_FAILED = "Your style couldn't be saved. Try again.";
const REFERENCE_FAILED = "That couldn't be added to your style. Try again.";
const REMOVE_FAILED = "That couldn't be removed from your style. Try again.";
const ANALYSIS_FAILED = "What we found in that video couldn't be saved. Try again.";
const CHANNEL_FAILED = "Your channel's videos couldn't be loaded. Try again.";

const isString = (v: unknown): v is string => typeof v === "string";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function isStyle(body: unknown): body is Style {
  if (!isRecord(body)) return false;
  const { profile, notes, updatedAt, updatedBy, updatedByName } = body;
  return (
    isRecord(profile) &&
    isString(notes) &&
    (updatedAt === null || isString(updatedAt)) &&
    (updatedBy === null || isString(updatedBy)) &&
    (updatedByName === undefined || isString(updatedByName))
  );
}

function isReference(body: unknown): body is StyleReference {
  if (!isRecord(body)) return false;
  const { id, kind, title, status, analysis, hasSheet, createdAt } = body;
  return isString(id) && isString(kind) && isString(title) && isString(status) && (analysis === null || isRecord(analysis)) && typeof hasSheet === "boolean" && isString(createdAt);
}

// The server's message when it refused, else the call's own words.
async function refusal(response: Response, failed: string): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  const message = isRecord(body) ? body.message : undefined;
  return new Error(isString(message) ? message : failed);
}

async function answer<T>(response: Response, isShape: (body: unknown) => body is T, failed: string): Promise<T> {
  if (!response.ok) throw await refusal(response, failed);
  const body: unknown = await response.json().catch(() => null);
  if (!isShape(body)) throw new Error(failed);
  return body;
}

const isOptionalString = (v: unknown) => v === undefined || isString(v);

function isUpload(body: unknown): body is ChannelUpload {
  if (!isRecord(body)) return false;
  const { id, url, title, author, thumbnailUrl, seconds, description, tags } = body;
  return (
    isString(id) &&
    isString(url) &&
    isString(title) &&
    isOptionalString(author) &&
    isOptionalString(thumbnailUrl) &&
    (seconds === undefined || typeof seconds === "number") &&
    isOptionalString(description) &&
    (tags === undefined || (Array.isArray(tags) && tags.every(isString)))
  );
}

function isChannelStatus(body: unknown): body is ChannelStatus {
  if (!isRecord(body) || typeof body.on !== "boolean") return false;
  if (!body.on) return true;
  if (body.connected === false) return body.message === undefined || isString(body.message);
  return body.connected === true && isString(body.channelTitle) && Array.isArray(body.videos) && body.videos.every(isUpload);
}

const hasReference = (body: unknown): body is { reference: StyleReference } => isRecord(body) && isReference(body.reference);
const hasReferences = (body: unknown): body is { references: StyleReference[] } =>
  isRecord(body) && Array.isArray(body.references) && body.references.every(isReference);

const styleUrl = (spaceId: string) => `/api/style?space=${encodeURIComponent(spaceId)}`;
const referencesUrl = (spaceId: string) => `/api/style/references?space=${encodeURIComponent(spaceId)}`;
const referenceUrl = (id: string) => `/api/style/references/${encodeURIComponent(id)}`;
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// A space's style.
export async function fetchStyle(spaceId: string): Promise<Style> {
  return answer(await fetch(styleUrl(spaceId), { cache: "no-store" }), isStyle, LOAD_FAILED);
}

// Changes the profile fields and notes named, and answers the style as it now is.
export async function saveStyle(spaceId: string, patch: StylePatch): Promise<Style> {
  return answer(await fetch(styleUrl(spaceId), json("PATCH", patch)), isStyle, SAVE_FAILED);
}

// What a space's style learns from, newest first.
export async function fetchReferences(spaceId: string): Promise<StyleReference[]> {
  const body = await answer(await fetch(referencesUrl(spaceId), { cache: "no-store" }), hasReferences, LOAD_FAILED);
  return body.references;
}

// Adds a video, a link or a past project to a space's style, and answers the new reference. A video comes back
// pending, for the page to measure it and save what it found with saveAnalysis.
export async function addReference(spaceId: string, source: ReferenceSource): Promise<StyleReference> {
  const body = await answer(await fetch(referencesUrl(spaceId), json("POST", source)), hasReference, REFERENCE_FAILED);
  return body.reference;
}

// What the Style page can offer from the space's YouTube channel: nothing on a server without YouTube, no channel
// (and why, when there's something to say), or the channel's name and newest uploads. For editors only.
export async function fetchChannel(spaceId: string): Promise<ChannelStatus> {
  return answer(await fetch(`/api/style/channel?space=${encodeURIComponent(spaceId)}`, { cache: "no-store" }), isChannelStatus, CHANNEL_FAILED);
}

// Adds one of the channel's uploads to a space's style by its YouTube id, and answers the new reference (ready at
// once, with what YouTube says about the video). Adding one again refreshes what it says.
export async function addChannelVideo(spaceId: string, videoId: string): Promise<StyleReference> {
  const body = await answer(await fetch(referencesUrl(spaceId), json("POST", { kind: "channel", videoId })), hasReference, REFERENCE_FAILED);
  return body.reference;
}

// Takes a reference out of its space's style.
export async function removeReference(id: string): Promise<void> {
  const response = await fetch(referenceUrl(id), { method: "DELETE" });
  if (!response.ok) throw await refusal(response, REMOVE_FAILED);
}

// Saves what the page measured in a video reference and the strip of frames it drew (a JPEG), or null when it drew
// none. Answers the reference, now ready.
export async function saveAnalysis(id: string, analysis: VideoAnalysis, sheet: Blob | Uint8Array | null): Promise<StyleReference> {
  const bytes = sheet === null ? null : sheet instanceof Uint8Array ? sheet : new Uint8Array(await sheet.arrayBuffer());
  const body = { analysis, ...(bytes !== null && { sheet: packBytes(bytes) }) };
  return (await answer(await fetch(`${referenceUrl(id)}/analysis`, json("PUT", body)), hasReference, ANALYSIS_FAILED)).reference;
}

// Marks a video reference failed, saying why in plain words, for when the page couldn't measure it. A video another
// tab finished measuring stays ready. Answers the reference.
export async function failAnalysis(id: string, reason: string): Promise<StyleReference> {
  return (await answer(await fetch(`${referenceUrl(id)}/analysis`, json("PUT", { failed: reason })), hasReference, ANALYSIS_FAILED)).reference;
}

// Where a video reference's strip of frames is served. version (its analysis's analyzedAt, say) makes a new strip a
// new address, so a strip the browser kept for a while isn't shown after the video is measured again.
export function sheetUrl(id: string, version?: string): string {
  return `${referenceUrl(id)}/sheet${version === undefined ? "" : `?v=${encodeURIComponent(version)}`}`;
}
