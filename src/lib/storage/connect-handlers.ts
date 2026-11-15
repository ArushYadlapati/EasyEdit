import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { apiRoute } from "@/lib/api-route";
import { DriveError } from "@/lib/drive/token";
import { ServiceError } from "@/lib/service-error";
import { slugFor } from "@/lib/spaces/paths";
import { listMySpaces } from "@/lib/spaces/service";
import type { MySpace } from "@/lib/spaces/types";
import type { StorageConfig } from "./config";
import { saveConnection } from "./connections";
import { authorizeUrl, ConnectionBrokenError, DRIVE_FILE_SCOPE, exchangeCode, OAuthError, pkcePair } from "./google-oauth";
import { open, seal } from "./secret-box";
import type { SetUpStorage } from "./setup-types";

export type ConnectHandlerDeps = {
  db: () => DB;
  auth: (req: Request) => Promise<CurrentUser | Response>;
  config: () => StorageConfig | null;
  fetch?: typeof fetch;
  now?: () => Date;
  setUp: SetUpStorage;
};

// What the browser keeps between pressing "Connect Google Drive" and Google sending it back: sealed with the token key,
// so it can't be read or made up. Only /api/storage gets it.
export const OAUTH_COOKIE = "ee_storage_oauth";
const COOKIE_PATH = "/api/storage";
const LIFE_SECONDS = 600;

const startedShape = z.object({
  state: z.string().min(1),
  verifier: z.string().min(1),
  userId: z.string().min(1),
  spaceId: z.string().min(1),
  exp: z.number(),
  return: z.string().optional(),
});
type Started = z.infer<typeof startedShape>;

const NOT_CONFIGURED_BODY = { code: "STORAGE_NOT_CONFIGURED", message: "Google Drive storage isn't set up on this server." } as const;
const SPACE_NOT_FOUND_BODY = { code: "NOT_FOUND", message: "Space not found" } as const;
const REFUSED_BODY = {
  code: "STORAGE_CONNECT_REFUSED",
  message: "This Google Drive connection wasn't started here, or it took too long. Start again from storage settings.",
} as const;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

const firstValue = (value: string | null) => value?.split(",")[0].trim() || null;
const isHttps = (req: Request) => (firstValue(req.headers.get("x-forwarded-proto")) ?? new URL(req.url).protocol.slice(0, -1)) === "https";

function cookieLine(req: Request, value: string, maxAge: number): string {
  return `${OAUTH_COOKIE}=${value}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isHttps(req) ? "; Secure" : ""}`;
}

function cookieFrom(req: Request): string | null {
  for (const pair of (req.headers.get("cookie") ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === OAUTH_COOKIE) return pair.slice(at + 1).trim() || null;
  }
  return null;
}

// A path in this app under /s/, and nothing else: never another site, never a path that climbs out of /s/.
export function returnPath(value: string | null): string | null {
  if (!value || value.length > 512 || !value.startsWith("/s/") || value.includes("\\")) return null;
  const probe = "https://return.invalid";
  let url: URL;
  try {
    url = new URL(value, probe);
  } catch {
    return null;
  }
  if (url.origin !== probe || !url.pathname.startsWith("/s/")) return null;
  return url.pathname + url.search;
}

// Both hashed first, so the comparison takes as long whatever the lengths.
function sameState(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

function unseal(value: string | null, key: Uint8Array): Started | null {
  if (!value) return null;
  try {
    const parsed = startedShape.safeParse(JSON.parse(open(value, key)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// The space with the person's role in it. Null when they are not a member.
async function mySpace(db: DB, userId: string, spaceId: string): Promise<MySpace | null> {
  return (await listMySpaces(db, userId)).find((space) => space.id === spaceId) ?? null;
}

const storagePage = (space: MySpace, note: string) => `/s/${slugFor(space)}/settings/storage?storage=${note}`;

// Only an admin of a space connects storage for it (a personal space's owner is its admin). Anyone else gets the
// answer an unknown space gets.
export function makeConnectHandlers(deps: ConnectHandlerDeps): { connect(req: Request): Promise<Response>; callback(req: Request): Promise<Response> } {
  const now = deps.now ?? (() => new Date());
  const fetchFn = deps.fetch ?? fetch;
  const notFound = () => Response.json(SPACE_NOT_FOUND_BODY, { status: 404 });
  const adminSpace = async (userId: string, spaceId: string | null) => {
    const space = spaceId ? await mySpace(deps.db(), userId, spaceId) : null;
    return space?.role === "admin" ? space : null;
  };

  // GET /api/storage/connect?space=<id>[&hint=<email>][&return=/s/…]
  const connect = apiRoute(async (req: Request): Promise<Response> => {
    const user = await deps.auth(req);
    if (user instanceof Response) return user;
    const cfg = deps.config();
    if (!cfg) return Response.json(NOT_CONFIGURED_BODY, { status: 409 });
    const params = new URL(req.url).searchParams;
    const space = await adminSpace(user.id, params.get("space") || null);
    if (!space) return notFound();

    const state = randomBytes(32).toString("base64url");
    const { verifier, challenge } = pkcePair();
    const back = returnPath(params.get("return"));
    const started: Started = { state, verifier, userId: user.id, spaceId: space.id, exp: now().getTime() + LIFE_SECONDS * 1000, ...(back ? { return: back } : {}) };
    const hint = params.get("hint");
    const location = authorizeUrl(cfg, { state, codeChallenge: challenge, ...(hint && EMAIL.test(hint) ? { loginHint: hint } : {}) });
    return new Response(null, {
      status: 302,
      headers: { location, "set-cookie": cookieLine(req, seal(JSON.stringify(started), cfg.tokenKey), LIFE_SECONDS), "cache-control": "no-store" },
    });
  });

  // Everything after the cookie has been checked: what Google answered, the code exchanged, the connection saved.
  async function finish(req: Request, cfg: StorageConfig, user: CurrentUser): Promise<Response> {
    const params = new URL(req.url).searchParams;
    const started = unseal(cookieFrom(req), cfg.tokenKey);
    const state = params.get("state");
    const refused = () => Response.json(REFUSED_BODY, { status: 400 });
    if (!started || !state || !sameState(state, started.state)) return refused();
    if (started.exp <= now().getTime() || started.userId !== user.id) return refused();
    const space = await adminSpace(user.id, started.spaceId);
    if (!space) return notFound();

    const go = (path: string) => new Response(null, { status: 302, headers: { location: new URL(path, new URL(cfg.redirectUri).origin).toString(), "cache-control": "no-store" } });
    const error = params.get("error");
    if (error) return go(storagePage(space, error === "access_denied" ? "cancelled" : "failed"));
    const code = params.get("code");
    if (!code) return refused();

    let granted: Awaited<ReturnType<typeof exchangeCode>>;
    try {
      granted = await exchangeCode(cfg, { code, codeVerifier: started.verifier }, fetchFn);
    } catch (failure) {
      if (!(failure instanceof DriveError || failure instanceof OAuthError)) throw failure;
      console.error("Connecting Google Drive failed:", failure.message);
      return go(storagePage(space, "failed"));
    }
    // The person can untick the Drive box on Google's screen: then there is nothing to store.
    if (!granted.scopes.includes(DRIVE_FILE_SCOPE)) return go(storagePage(space, "needs-drive"));

    const connection = await saveConnection(deps.db(), cfg, {
      userId: user.id,
      googleSub: granted.googleSub,
      email: granted.email,
      refreshToken: granted.refreshToken,
      scopes: granted.scopes,
    });
    try {
      await deps.setUp(deps.db(), { spaceId: space.id, connectionId: connection.id, byUserId: user.id });
    } catch (failure) {
      if (!(failure instanceof ServiceError || failure instanceof DriveError || failure instanceof ConnectionBrokenError)) throw failure;
      console.error("Setting up storage failed:", failure.message);
      return go(storagePage(space, "failed"));
    }
    return go((started.return && returnPath(started.return)) || storagePage(space, "connected"));
  }

  // GET /api/storage/callback?code&state (or ?error&state).
  const answer = apiRoute(async (req: Request): Promise<Response> => {
    const user = await deps.auth(req);
    if (user instanceof Response) return user;
    const cfg = deps.config();
    return cfg ? finish(req, cfg, user) : Response.json(NOT_CONFIGURED_BODY, { status: 409 });
  });
  // Every answer clears the cookie, a failure too: it is used once.
  const callback = async (req: Request): Promise<Response> => {
    const res = await answer(req);
    const headers = new Headers(res.headers);
    headers.append("set-cookie", cookieLine(req, "", 0));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };

  return { connect, callback };
}
