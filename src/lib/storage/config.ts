import "server-only";

export type StorageConfig = {
  clientId: string;
  clientSecret: string;
  tokenKey: Uint8Array; // 32 bytes, seals refresh tokens
  redirectUri: string;
};

type Settings = Record<string, string | undefined>;

// The only place the storage settings are read. The OAuth client is the one sign-in uses.
// null when any required setting is missing or empty, or the token key is not 32 bytes of base64: connecting a Drive is not set up.
// Nothing in here is ever put in a message.
let keyWarned = false;
export const resetKeyWarning = () => {
  keyWarned = false;
};

export function storageConfig(env: Settings = process.env): StorageConfig | null {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, STORAGE_TOKEN_KEY: key, BETTER_AUTH_URL: base } = env;
  if (!clientId || !clientSecret || !key || !base) return null;
  const tokenKey = Buffer.from(key, "base64");
  if (tokenKey.length !== 32) {
    // Still "not set up" to people, but whoever runs the server is told why, once. Never the value.
    if (!keyWarned) {
      keyWarned = true;
      console.error("STORAGE_TOKEN_KEY is set but is not 32 bytes of base64, so Google Drive storage is switched off. Generate one with: openssl rand -base64 32");
    }
    return null;
  }
  return {
    clientId,
    clientSecret,
    tokenKey: new Uint8Array(tokenKey),
    redirectUri: `${base.replace(/\/+$/, "")}/api/storage/callback`,
  };
}
