import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { DriveError, reach, refusalReason } from "@/lib/drive/token";
import type { StorageConfig } from "./config";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export class ConnectionBrokenError extends Error {
  name = "ConnectionBrokenError" as const;
  reason: "revoked" | "expired" | "unknown";
  constructor(reason: "revoked" | "expired" | "unknown") {
    super(`Drive connection is broken: ${reason}`);
    this.reason = reason;
  }
}

// What is wrong with an answer from Google that cannot be used. A code, never the answer.
export class OAuthError extends Error {
  name = "OAuthError" as const;
  reason: string;
  constructor(reason: string) {
    super(`Google sign-in answer refused: ${reason}`);
    this.reason = reason;
  }
}

// A PKCE verifier and its S256 challenge.
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizeUrl(cfg: StorageConfig, input: { state: string; codeChallenge: string; loginHint?: string }): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: `openid email ${DRIVE_FILE_SCOPE}`,
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "false",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  if (input.loginHint) params.set("login_hint", input.loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

async function tokenCall(fetchFn: typeof fetch, form: Record<string, string>): Promise<Response> {
  return reach(fetchFn, "oauth", TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

// The id_token came straight from Google's token endpoint over TLS in a server-to-server call, so its payload can be
// trusted once it is decoded and checked: no signature check against Google's keys is needed.
function readIdToken(idToken: unknown, clientId: string, nowMs: number): { sub: string; email: string } {
  if (typeof idToken !== "string") throw new OAuthError("no_id_token");
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    throw new OAuthError("bad_id_token");
  }
  if (!isRecord(claims)) throw new OAuthError("bad_id_token");
  const { aud, iss, exp, sub, email, email_verified: verified } = claims;
  if (aud !== clientId) throw new OAuthError("wrong_audience");
  if (typeof iss !== "string" || !ISSUERS.includes(iss)) throw new OAuthError("wrong_issuer");
  if (typeof exp !== "number" || exp * 1000 <= nowMs) throw new OAuthError("expired_id_token");
  if (typeof sub !== "string" || !sub || typeof email !== "string" || !email) throw new OAuthError("bad_id_token");
  if (verified !== true) throw new OAuthError("email_not_verified");
  return { sub, email };
}

export async function exchangeCode(
  cfg: StorageConfig,
  input: { code: string; codeVerifier: string },
  fetchFn: typeof fetch = fetch,
): Promise<{ refreshToken: string; accessToken: string; expiresAt: number; scopes: string[]; googleSub: string; email: string }> {
  const askedAt = Date.now();
  const response = await tokenCall(fetchFn, {
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.codeVerifier,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
  });
  if (!response.ok) throw new DriveError("oauth", response.status, await refusalReason(response));
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) throw new OAuthError("bad_answer");
  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, scope } = body;
  if (typeof accessToken !== "string" || typeof expiresIn !== "number") throw new OAuthError("bad_answer");
  if (typeof refreshToken !== "string" || !refreshToken) throw new OAuthError("no_refresh_token");
  const { sub, email } = readIdToken(body.id_token, cfg.clientId, askedAt);
  return {
    refreshToken,
    accessToken,
    expiresAt: askedAt + expiresIn * 1000,
    scopes: typeof scope === "string" ? scope.split(" ").filter(Boolean) : [],
    googleSub: sub,
    email,
  };
}

// invalid_grant is Google saying the connection is gone (revoked, or a refresh token that lapsed). Any other failure
// (no network, a 500) says nothing about the connection and comes out as a DriveError.
export async function refreshAccess(
  cfg: StorageConfig,
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresAt: number }> {
  const askedAt = Date.now();
  const response = await tokenCall(fetchFn, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  if (!response.ok) {
    const reason = await refusalReason(response);
    if (reason === "invalid_grant") throw new ConnectionBrokenError("revoked");
    throw new DriveError("oauth", response.status, reason);
  }
  const body: unknown = await response.json().catch(() => null);
  const { access_token: accessToken, expires_in: expiresIn } = isRecord(body) ? body : {};
  if (typeof accessToken !== "string" || typeof expiresIn !== "number") throw new OAuthError("bad_answer");
  return { accessToken, expiresAt: askedAt + expiresIn * 1000 };
}

// Ends EasyEdit's access to a Google account: revoking the refresh token also ends the access tokens made from it.
// A token Google no longer knows (400) is already as good as revoked. Anything else comes out as a DriveError.
export async function revokeGrant(refreshToken: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const answer = await reach(fetchFn, "oauth", REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  });
  if (!answer.ok && answer.status !== 400) throw new DriveError("oauth", answer.status, await refusalReason(answer));
}
