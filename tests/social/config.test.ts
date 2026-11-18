import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { socialConfig } from "@/lib/social/config";

const KEY = randomBytes(32).toString("base64");
const env = { YOUTUBE_CLIENT_ID: "yt-client", YOUTUBE_CLIENT_SECRET: "yt-secret", STORAGE_TOKEN_KEY: KEY, BETTER_AUTH_URL: "https://app.test/" };

describe("socialConfig", () => {
  it("reads the YouTube client, the storage key and the app's address", () => {
    const cfg = socialConfig(env);
    expect(cfg).toMatchObject({ clientId: "yt-client", clientSecret: "yt-secret", redirectUri: "https://app.test/api/social/youtube/callback" });
    expect(cfg?.tokenKey).toHaveLength(32);
  });

  it("is null without any one of them: posting does not exist on this server", () => {
    for (const name of Object.keys(env)) expect(socialConfig({ ...env, [name]: "" }), name).toBeNull();
  });

  it("never falls back to the sign-in client", () => {
    expect(socialConfig({ GOOGLE_CLIENT_ID: "sign-in", GOOGLE_CLIENT_SECRET: "shh", STORAGE_TOKEN_KEY: KEY, BETTER_AUTH_URL: "https://app.test" })).toBeNull();
  });

  it("is null with a key that is not 32 bytes", () => {
    expect(socialConfig({ ...env, STORAGE_TOKEN_KEY: "c2hvcnQ=" })).toBeNull();
  });
});
