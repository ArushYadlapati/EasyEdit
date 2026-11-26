import { MEDIA_MESSAGES } from "@/lib/media/messages";
import type { ChannelStatus } from "@/lib/style/channel";
import { addChannelVideo, addReference, fetchChannel, removeReference, saveStyle } from "@/lib/style/client";
import type { ReferenceSource, Style, StylePatch, StyleReference } from "@/lib/style/types";

// What the Style page asks the server, as functions, so tests can give their own. Each refuses with an Error whose
// message is written for people.
export type StyleApi = {
  saveStyle(spaceId: string, patch: StylePatch): Promise<Style>;
  addReference(spaceId: string, source: ReferenceSource): Promise<StyleReference>;
  removeReference(id: string): Promise<void>;
  fetchChannel(spaceId: string): Promise<ChannelStatus>;
  addChannelVideo(spaceId: string, videoId: string): Promise<StyleReference>;
};

// The page's own calls, to /api/style.
export const BROWSER_STYLE_API: StyleApi = { saveStyle, addReference, removeReference, fetchChannel, addChannelVideo };

// The words to show for a call that didn't go through. The style client throws a plain Error holding the server's
// refusal or its own words, both written for people; anything else (the TypeError of a server that couldn't be
// reached, "Failed to fetch") says to check the connection.
export function failureWords(error: unknown): string {
  return error instanceof Error && error.name === "Error" && error.message ? error.message : MEDIA_MESSAGES.noAnswer;
}
