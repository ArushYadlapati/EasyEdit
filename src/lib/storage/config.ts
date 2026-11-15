import "server-only";

export type StorageConfig = {
  clientId: string;
  clientSecret: string;
  tokenKey: Uint8Array; // 32 bytes, seals refresh tokens
  redirectUri: string;
  // The Google Cloud project id where each team's read-only reader service account is created (IAM path projects/{id}/serviceAccounts).
  // null (GOOGLE_CLOUD_PROJECT unset): teams can't get storage; personal spaces still can.
  projectId: string | null;
};

type Settings = Record<string, string | undefined>;

// The only place the storage settings are read. The OAuth client is the one sign-in uses.
// null when any required setting is missing or empty, or the token key is not 32 bytes of base64: connecting a Drive is not set up.
// Nothing in here is ever put in a message.
export function storageConfig(env: Settings = process.env): StorageConfig | null {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, STORAGE_TOKEN_KEY: key, BETTER_AUTH_URL: base } = env;
  if (!clientId || !clientSecret || !key || !base) return null;
  const tokenKey = Buffer.from(key, "base64");
  if (tokenKey.length !== 32) return null;
  return {
    clientId,
    clientSecret,
    tokenKey: new Uint8Array(tokenKey),
    redirectUri: `${base.replace(/\/+$/, "")}/api/storage/callback`,
    projectId: env.GOOGLE_CLOUD_PROJECT || null,
  };
}
