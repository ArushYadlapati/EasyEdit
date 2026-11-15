import { createSign } from "node:crypto";

export const SCOPE_WRITE = "https://www.googleapis.com/auth/drive";
export const SCOPE_READ = "https://www.googleapis.com/auth/drive.readonly";
// The app's own service account asks IAM for a team reader's token with this one. Never handed out.
export const SCOPE_CLOUD = "https://www.googleapis.com/auth/cloud-platform";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const IMPERSONATE_URL = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts";
// A service account's address, and nothing else: it goes into a request's path.
const SERVICE_ACCOUNT_EMAIL = /^[a-z][-a-z0-9]{4,28}[a-z0-9]@[a-z][-a-z0-9]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
export const isServiceAccountEmail = (email: string) => SERVICE_ACCOUNT_EMAIL.test(email);
// How long to wait between tries for a service account that was only just made and is not known everywhere yet.
const NEW_ACCOUNT_WAITS_MS = [500, 1000, 2000];
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const REQUEST_LIFE_SECONDS = 3600;
const DEFAULT_MIN_SECONDS_LEFT = 300;
// Letters, digits and _ only, and short: a reason is a code, never a sentence, an address or a token.
const SHORT_CODE = /^[A-Za-z0-9_]{1,64}$/;

// What every failed Google call becomes: which call, the status, and a short code. Nothing else from the answer is kept.
export class DriveError extends Error {
  name = "DriveError" as const;
  call: string; // "token", "session", "file" …
  status: number; // 0 when Google gave no answer at all
  reason: string; // a short code from Google's answer, else "unknown"; "unreachable" when it gave none

  constructor(call: string, status: number, reason: string) {
    const code = SHORT_CODE.test(reason) ? reason : "unknown";
    super(`Drive call failed: ${call} ${status} ${code}`);
    this.call = call;
    this.status = status;
    this.reason = code;
  }
}

export type GoogleToken = { accessToken: string; expiresAt: number }; // expiresAt in ms

export type TokenSource = { tokenFor(scope: string, minSecondsLeft?: number): Promise<GoogleToken> };

// Where a Drive client gets the token for its calls: one identity, one scope. A token with less than
// `minSecondsLeft` (default 300) left is not given out.
export type AccessSource = { token(minSecondsLeft?: number): Promise<GoogleToken> };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

// The short code in a refusal from Google: `error` from the token endpoint, `error.errors[0].reason` from the Drive API,
// else `error.status` (IAM's "ALREADY_EXISTS", "NOT_FOUND" …). "unknown" when the answer has none. The rest is not kept.
export async function refusalReason(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const error = isRecord(body) ? body.error : undefined;
  if (typeof error === "string") return error;
  const first: unknown = isRecord(error) && Array.isArray(error.errors) ? error.errors[0] : undefined;
  if (isRecord(first) && typeof first.reason === "string") return first.reason;
  return isRecord(error) && typeof error.status === "string" ? error.status : "unknown";
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// `attempt` again after each of the waits while `again` says its failure may pass (a service account only just made).
export async function retrying<T>(attempt: () => Promise<T>, again: (error: unknown) => boolean, sleep: (ms: number) => Promise<void> = wait): Promise<T> {
  for (const ms of NEW_ACCOUNT_WAITS_MS) {
    try {
      return await attempt();
    } catch (error) {
      if (!again(error)) throw error;
    }
    await sleep(ms);
  }
  return attempt();
}

// One request to Google. When none of it is answered (no connection, a reset, a timeout) there is no status and no
// code, so the error says 0 and "unreachable". What fetch threw is not kept: it can quote the address it was given.
export async function reach(fetchFn: typeof fetch, call: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch {
    throw new DriveError(call, 0, "unreachable");
  }
}

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

// The request for a token, signed with the service account's key.
function signedRequest(clientEmail: string, privateKey: string, scope: string, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const unsigned = `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url({ iss: clientEmail, scope, aud: TOKEN_URL, iat, exp: iat + REQUEST_LIFE_SECONDS })}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url")}`;
}

// One token kept, asked for again when too little of its time is left. Calls made while a request is in flight share
// it. A request that fails is forgotten, so the next call asks again.
function keptSource(ask: () => Promise<GoogleToken>, now: () => number): AccessSource {
  let kept: GoogleToken | null = null;
  let asking: Promise<GoogleToken> | null = null;
  return {
    token(minSecondsLeft = DEFAULT_MIN_SECONDS_LEFT) {
      if (kept && kept.expiresAt - now() > minSecondsLeft * 1000) return Promise.resolve(kept);
      asking ??= ask()
        .then((token) => (kept = token))
        .finally(() => (asking = null));
      return asking;
    },
  };
}

// The service account's own tokens for one scope, from Google's token endpoint with a request signed by its key.
export function serviceAccountSource(deps: { clientEmail: string; privateKey: string; scope: string; fetch?: typeof fetch; now?: () => number }): AccessSource {
  const fetchFn = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  return keptSource(async () => {
    const askedAt = now(); // a token's time runs from before the request, so it is never kept too long
    const response = await reach(fetchFn, "token", TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${GRANT_TYPE}&assertion=${signedRequest(deps.clientEmail, deps.privateKey, deps.scope, askedAt)}`,
    });
    if (!response.ok) throw new DriveError("token", response.status, await refusalReason(response));
    const body: unknown = await response.json().catch(() => null);
    const { access_token: accessToken, expires_in: expiresIn } = isRecord(body) ? body : {};
    if (typeof accessToken !== "string" || accessToken === "" || typeof expiresIn !== "number" || !(expiresIn > 0)) {
      throw new DriveError("token", response.status, "unknown");
    }
    return { accessToken, expiresAt: askedAt + expiresIn * 1000 };
  }, now);
}

// Tokens for the service account, one source per scope.
export function createTokenSource(deps: { clientEmail: string; privateKey: string; fetch?: typeof fetch; now?: () => number }): TokenSource {
  const sources = new Map<string, AccessSource>();
  return {
    tokenFor(scope, minSecondsLeft) {
      let source = sources.get(scope);
      if (!source) sources.set(scope, (source = serviceAccountSource({ ...deps, scope })));
      return source.token(minSecondsLeft);
    },
  };
}

// A person's connection: `refresh` trades their refresh token for an access token. What it throws comes out as it is
// (a broken connection is the caller's to record).
export function connectionSource(deps: { refresh: () => Promise<{ accessToken: string; expiresAt: number }>; now?: () => number }): AccessSource {
  return keptSource(async () => {
    const { accessToken, expiresAt } = await deps.refresh();
    return { accessToken, expiresAt };
  }, deps.now ?? Date.now);
}

// Another service account's token (a team's reader), made by IAM Credentials for `caller`, which holds the app's
// service account token for SCOPE_CLOUD. No key of the other account exists. Good for an hour.
export function impersonatedSource(deps: {
  caller: AccessSource;
  targetEmail: string;
  scope: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): AccessSource {
  const fetchFn = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const ask = async (): Promise<GoogleToken> => {
    if (!isServiceAccountEmail(deps.targetEmail)) throw new DriveError("impersonate", 0, "bad_account");
    const { accessToken: callerToken } = await deps.caller.token();
    const response = await reach(fetchFn, "impersonate", `${IMPERSONATE_URL}/${deps.targetEmail}:generateAccessToken`, {
      method: "POST",
      headers: { Authorization: `Bearer ${callerToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ scope: [deps.scope], lifetime: `${REQUEST_LIFE_SECONDS}s` }),
    });
    if (!response.ok) throw new DriveError("impersonate", response.status, await refusalReason(response));
    const body: unknown = await response.json().catch(() => null);
    const { accessToken, expireTime } = isRecord(body) ? body : {};
    const expiresAt = typeof expireTime === "string" ? Date.parse(expireTime) : Number.NaN;
    if (typeof accessToken !== "string" || accessToken === "" || !(expiresAt > now())) throw new DriveError("impersonate", response.status, "unknown");
    return { accessToken, expiresAt };
  };
  // A reader made a moment ago may not be known to IAM Credentials yet: it answers 404 until it is.
  const notYet = (error: unknown) => error instanceof DriveError && error.call === "impersonate" && error.status === 404;
  return keptSource(() => retrying(ask, notYet, deps.sleep), now);
}
