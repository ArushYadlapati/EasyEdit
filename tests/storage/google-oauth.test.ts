import { describe, expect, it, vi } from "vitest";
import {
  authorizeUrl,
  ConnectionBrokenError,
  DRIVE_FILE_SCOPE,
  exchangeCode,
  pkcePair,
  refreshAccess,
} from "@/lib/storage/google-oauth";
import { resetKeyWarning, storageConfig, type StorageConfig } from "@/lib/storage/config";
import { createHash, randomBytes } from "node:crypto";

const cfg: StorageConfig = {
  clientId: "client-1",
  clientSecret: "shh",
  tokenKey: randomBytes(32),
  redirectUri: "https://app.test/api/storage/callback",
  projectId: null,
};

const idToken = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const goodClaims = () => ({
  iss: "https://accounts.google.com",
  aud: "client-1",
  sub: "sub-9",
  email: "a@b.co",
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 600,
});
const reply = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("storageConfig", () => {
  const env = {
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "sec",
    STORAGE_TOKEN_KEY: randomBytes(32).toString("base64"),
    BETTER_AUTH_URL: "https://app.test",
  };
  it("reads settings", () => {
    const c = storageConfig(env)!;
    expect(c.redirectUri).toBe("https://app.test/api/storage/callback");
    expect(c.tokenKey.length).toBe(32);
    expect(c.projectId).toBeNull();
  });
  it("is null when something is missing or the key is the wrong size", () => {
    expect(storageConfig({ ...env, STORAGE_TOKEN_KEY: undefined })).toBeNull();
    expect(storageConfig({ ...env, STORAGE_TOKEN_KEY: "AAAA" })).toBeNull();
  });
  it("logs one clear error naming the variable, never its value, for a key of the wrong size", () => {
    resetKeyWarning();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const bad = { ...env, STORAGE_TOKEN_KEY: "c2VjcmV0LXNob3J0LWtleQ==" };
      expect(storageConfig(bad)).toBeNull();
      expect(storageConfig(bad)).toBeNull();
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0].join(" "));
      expect(line).toContain("STORAGE_TOKEN_KEY");
      expect(line).not.toContain(bad.STORAGE_TOKEN_KEY);
      log.mockClear();
      storageConfig({ ...env, STORAGE_TOKEN_KEY: undefined }); // not set at all: nothing to say
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe("authorizeUrl", () => {
  it("asks for the three scopes, offline, with PKCE", () => {
    const url = new URL(authorizeUrl(cfg, { state: "st", codeChallenge: "ch", loginHint: "x@y.z" }));
    const p = url.searchParams;
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(p.get("scope")).toBe(`openid email ${DRIVE_FILE_SCOPE}`);
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent select_account");
    expect(p.get("include_granted_scopes")).toBe("false");
    expect(p.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(p.get("state")).toBe("st");
    expect(p.get("code_challenge")).toBe("ch");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("login_hint")).toBe("x@y.z");
  });
});

describe("pkcePair", () => {
  it("makes an S256 challenge of the verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
});

describe("exchangeCode", () => {
  const ok = (claims: Record<string, unknown>) =>
    reply(200, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: `openid https://www.googleapis.com/auth/userinfo.email ${DRIVE_FILE_SCOPE}`,
      id_token: idToken(claims),
    });

  it("returns tokens, sub, email and granted scopes", async () => {
    const calls: { url: string; body: string }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return (await ok(goodClaims())(url, init)) as Response;
    }) as unknown as typeof fetch;
    const r = await exchangeCode(cfg, { code: "c", codeVerifier: "v" }, f);
    expect(r).toMatchObject({ refreshToken: "rt", accessToken: "at", googleSub: "sub-9", email: "a@b.co" });
    expect(r.scopes).toContain(DRIVE_FILE_SCOPE);
    expect(r.expiresAt).toBeGreaterThan(Date.now());
    expect(calls[0].body).toContain("code_verifier=v");
  });

  it("refuses the wrong audience, issuer, expiry, unverified email, no refresh token", async () => {
    for (const bad of [{ aud: "other" }, { iss: "https://evil.test" }, { exp: 1 }, { email_verified: false }]) {
      await expect(exchangeCode(cfg, { code: "c", codeVerifier: "v" }, ok({ ...goodClaims(), ...bad }))).rejects.toThrow();
    }
    const noRefresh = reply(200, { access_token: "a", expires_in: 1, scope: "openid", id_token: idToken(goodClaims()) });
    await expect(exchangeCode(cfg, { code: "c", codeVerifier: "v" }, noRefresh)).rejects.toThrow();
  });

  it("does not put secrets in errors", async () => {
    const err = await exchangeCode(cfg, { code: "secretcode", codeVerifier: "v" }, reply(400, { error: "invalid_grant" })).catch((e) => e);
    expect(String(err)).not.toMatch(/secretcode|shh/);
  });
});

describe("refreshAccess", () => {
  it("returns a new access token", async () => {
    const r = await refreshAccess(cfg, "rt", reply(200, { access_token: "n", expires_in: 3600 }));
    expect(r.accessToken).toBe("n");
    expect(r.expiresAt).toBeGreaterThan(Date.now());
  });
  it("maps invalid_grant to a revoked connection", async () => {
    const e = await refreshAccess(cfg, "rt", reply(400, { error: "invalid_grant" })).catch((x) => x);
    expect(e).toBeInstanceOf(ConnectionBrokenError);
    expect(e.reason).toBe("revoked");
  });
  it("other failures are not a broken connection", async () => {
    const e = await refreshAccess(cfg, "rt", reply(500, {})).catch((x) => x);
    expect(e).not.toBeInstanceOf(ConnectionBrokenError);
    expect(e.status).toBe(500);
  });
});
