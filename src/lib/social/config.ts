import "server-only";
import type { StorageConfig } from "@/lib/storage/config";

// The same shape as the storage settings, so Google's code exchange, refresh and revoke (storage/google-oauth.ts)
// work for a YouTube connection as they are.
export type SocialConfig = StorageConfig;

type Settings = Record<string, string | undefined>;

// The only place the posting settings are read. YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET name the Google sign-in
// client that may use the YouTube API (it can be the one sign-in uses); tokens are sealed with the storage key.
// null when any of them is missing or the key is not 32 bytes of base64: posting to YouTube does not exist on this
// server (no tab, no button). Nothing in here is ever put in a message.
export function socialConfig(env: Settings = process.env): SocialConfig | null {
  const { YOUTUBE_CLIENT_ID: clientId, YOUTUBE_CLIENT_SECRET: clientSecret, STORAGE_TOKEN_KEY: key, BETTER_AUTH_URL: base } = env;
  if (!clientId || !clientSecret || !key || !base) return null;
  const tokenKey = Buffer.from(key, "base64");
  if (tokenKey.length !== 32) return null; // storageConfig tells whoever runs the server about a bad key
  return {
    clientId,
    clientSecret,
    tokenKey: new Uint8Array(tokenKey),
    redirectUri: `${base.replace(/\/+$/, "")}/api/social/youtube/callback`,
  };
}
