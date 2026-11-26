import "server-only";
import type { DB } from "@/db";
import { requireRole, type Actor } from "@/lib/actor";
import { DriveError } from "@/lib/drive/token";
import { ServiceError } from "@/lib/service-error";
import type { SocialConfig } from "@/lib/social/config";
import { channelAccess, findConnection } from "@/lib/social/connections";
import { refusalMessage, SOCIAL_MESSAGES } from "@/lib/social/messages";
import { isVideoId } from "@/lib/social/rules";
import { channelVideo, listMyUploads, type ChannelUpload } from "@/lib/social/youtube-api";
import { ConnectionBrokenError, OAuthError } from "@/lib/storage/google-oauth";
import { STYLE_MESSAGES } from "./messages";
import { addChannelReference } from "./service";
import type { StyleReference } from "./types";

// Picking videos for a space's style from its connected YouTube channel, on a server where posting to YouTube is set
// up. What a reference keeps of a video is read from YouTube with the channel's own permission, never taken from a
// browser.

// How many of the channel's newest uploads the Style page offers.
export const CHANNEL_UPLOADS = 25;

// What the Style page can offer from the space's YouTube channel. on: false, this server has no YouTube at all.
// connected: false, there is no channel to pick from: none is connected, EasyEdit may not see its videos, or reading
// it failed (broken), with message saying why in the person's words when there is something to say. Else the
// channel's name and its newest uploads.
export type ChannelStatus =
  | { on: false }
  | { on: true; connected: false; broken?: true; message?: string }
  | { on: true; connected: true; channelTitle: string; videos: ChannelUpload[] };

const brokenChannel = () => new ServiceError("CONNECTION_BROKEN", 409, SOCIAL_MESSAGES.broken);

// A failed read of the channel as a refusal in the person's words. Anything reading it can't fail with is thrown on.
function channelRefusal(failure: unknown): ServiceError {
  if (failure instanceof ServiceError) return failure;
  if (failure instanceof ConnectionBrokenError) return brokenChannel();
  if (failure instanceof OAuthError) return new ServiceError("PLATFORM_REFUSED", 502, SOCIAL_MESSAGES.unreachable);
  if (failure instanceof DriveError) {
    console.error("Reading a YouTube channel's videos failed:", failure.message);
    // refusalMessage's last resort is about a refused post, which reading a channel never is.
    const message = refusalMessage(failure);
    return new ServiceError("PLATFORM_REFUSED", 502, message === SOCIAL_MESSAGES.refused ? STYLE_MESSAGES.channelUnreadable : message);
  }
  throw failure;
}

// An editor's view of the space's YouTube channel for the Style page: whether there is one to pick videos from, and
// its newest uploads. A connection that is broken, or one EasyEdit may not see the videos of, isn't asked anything.
export async function channelStatus(db: DB, actor: Actor, cfg: SocialConfig | null, fetchFn: typeof fetch = fetch): Promise<ChannelStatus> {
  requireRole(actor, "editor");
  if (!cfg) return { on: false };
  const known = await findConnection(db, cfg, actor.spaceId);
  if (!known) return { on: true, connected: false };
  if (known.broken) return { on: true, connected: false, broken: true, message: SOCIAL_MESSAGES.broken };
  if (known.channelId === null) return { on: true, connected: false, message: STYLE_MESSAGES.channelHidden };
  try {
    const { accessToken, connection } = await channelAccess(db, cfg, actor.spaceId, fetchFn);
    // Connected again meanwhile, without the permission to see its videos.
    if (connection.channelId === null) return { on: true, connected: false, message: STYLE_MESSAGES.channelHidden };
    const videos = await listMyUploads(accessToken, fetchFn, CHANNEL_UPLOADS);
    return { on: true, connected: true, channelTitle: connection.channelTitle ?? connection.email, videos };
  } catch (failure) {
    const refusal = channelRefusal(failure);
    if (refusal.code === "NOT_CONNECTED") return { on: true, connected: false };
    return { on: true, connected: false, broken: true, message: refusal.message };
  }
}

// An editor adds one of the channel's uploads to the space's style, by its YouTube id. YouTube is asked about the
// video with the channel's own permission: one on another channel, or one YouTube doesn't show it, is refused, and
// what the reference keeps is what YouTube said. Adding one already there from the channel refreshes its facts.
// 404 on a server with no YouTube.
export async function addFromChannel(db: DB, actor: Actor, cfg: SocialConfig | null, videoId: string, fetchFn: typeof fetch = fetch): Promise<StyleReference> {
  requireRole(actor, "editor");
  if (!cfg) throw new ServiceError("NOT_FOUND", 404, STYLE_MESSAGES.channelOff);
  if (!isVideoId(videoId)) throw new ServiceError("INVALID", 400, STYLE_MESSAGES.notOnChannel);
  const known = await findConnection(db, cfg, actor.spaceId);
  if (!known) throw new ServiceError("NOT_CONNECTED", 409, SOCIAL_MESSAGES.notConnected);
  if (known.broken) throw brokenChannel();
  if (known.channelId === null) throw new ServiceError("NOT_CONNECTED", 409, STYLE_MESSAGES.channelHidden);

  let found: Awaited<ReturnType<typeof channelVideo>>;
  let channelId: string | null;
  try {
    const { accessToken, connection } = await channelAccess(db, cfg, actor.spaceId, fetchFn);
    channelId = connection.channelId;
    found = channelId === null ? null : await channelVideo(accessToken, videoId, fetchFn);
  } catch (failure) {
    throw channelRefusal(failure);
  }
  if (channelId === null) throw new ServiceError("NOT_CONNECTED", 409, STYLE_MESSAGES.channelHidden);
  if (!found || found.channelId !== channelId) throw new ServiceError("INVALID", 400, STYLE_MESSAGES.notOnChannel);
  return addChannelReference(db, actor, found);
}
