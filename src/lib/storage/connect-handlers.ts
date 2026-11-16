import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { apiRoute } from "@/lib/api-route";
import { DriveError } from "@/lib/drive/token";
import { ServiceError } from "@/lib/service-error";
import { slugFor } from "@/lib/spaces/paths";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { listMySpaces } from "@/lib/spaces/service";
import type { MySpace, SpaceKind } from "@/lib/spaces/types";
import { storageBlock } from "./availability";
import type { StorageConfig } from "./config";
import { saveConnection } from "./connections";
import { authorizeUrl, ConnectionBrokenError, DRIVE_FILE_SCOPE, exchangeCode, OAuthError, pkcePair } from "./google-oauth";
import type { StorageBlock } from "./messages";
import { open, seal } from "./secret-box";
import type { SetUpStorage } from "./setup";

export type ConnectHandlerDeps = {
  db: () => DB;
  auth: (req: Request) => Promise<CurrentUser | Response>;
  config: () => StorageConfig | null;
  fetch?: typeof fetch;
  now?: () => Date;
  setUp: SetUpStorage;
  // What stops this server setting storage up for a space of this kind; the pages' own check (storageBlock) by default.
  block?: (kind: SpaceKind) => StorageBlock;
};

// What the browser keeps between pressing "Choose Google account" and Google sending it back: sealed with the token key,
// so it can't be read or made up. Only /api/storage gets it.
export const OAUTH_COOKIE = "ee_storage_oauth";
const COOKIE_PATH = "/api/storage";
const LIFE_SECONDS = 600; // how long a started connect is good for (`exp`)
// The cookie outlives `exp`, so a connect that took too long can still be told apart from one never started here, and
// can go back to its space.
const COOKIE_SECONDS = 3600;

const startedShape = z.object({
  state: z.string().min(1),
  verifier: z.string().min(1),
  userId: z.string().min(1),
  spaceId: z.string().min(1),
  exp: z.number(),
  return: z.string().optional(),
});
type Started = z.infer<typeof startedShape>;

// Both routes are reached by the browser navigating, so every answer is a redirect to a page, never JSON. Whatever
// can't be trusted to name a space lands on this one fixed page.
const REFUSED_PAGE = "/dashboard?storage=refused";
const FAILED_PAGE = "/dashboard?storage=failed";

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

// A path in this app under /s/, or the welcome page (with any query), and nothing else: never another site, never a
// path that climbs out of /s/. The welcome page is where a new account's first connect comes back to.
export function returnPath(value: string | null): string | null {
  if (!value || value.length > 512 || value.includes("\\")) return null;
  const welcome = value === "/welcome" || value.startsWith("/welcome?");
  if (!welcome && !value.startsWith("/s/")) return null;
  const probe = "https://return.invalid";
  let url: URL;
  try {
    url = new URL(value, probe);
  } catch {
    return null;
  }
  if (url.origin !== probe) return null;
  if (welcome ? url.pathname !== "/welcome" : !url.pathname.startsWith("/s/")) return null;
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

// A redirect to a path of this app: on the configured address when there is one (never the request's Host), else as a
// path the browser resolves against the address it used.
function goTo(cfg: StorageConfig | null, path: string): Response {
  const location = cfg ? new URL(path, new URL(cfg.redirectUri).origin).toString() : path;
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}

// Anything that is not already a redirect (a signed-out or role answer from `auth`, apiRoute's 500) becomes one to a
// fixed page.
function asPage(cfg: StorageConfig | null, res: Response): Response {
  if (res.status >= 300 && res.status < 400 && res.headers.has("location")) return res;
  return goTo(cfg, res.status >= 500 ? FAILED_PAGE : REFUSED_PAGE);
}

// Only an admin of a space connects storage for it (a personal space's owner is its admin). Anyone else, a
// non-member of the space or a space that doesn't exist, lands on the same fixed refused page.
export function makeConnectHandlers(deps: ConnectHandlerDeps): { connect(req: Request): Promise<Response>; callback(req: Request): Promise<Response> } {
  const now = deps.now ?? (() => new Date());
  const fetchFn = deps.fetch ?? fetch;
  const block = deps.block ?? ((kind: SpaceKind) => storageBlock(kind, { config: deps.config }));
  const adminSpace = async (userId: string, spaceId: string | null) => {
    const space = spaceId ? await mySpace(deps.db(), userId, spaceId) : null;
    return space?.role === "admin" ? space : null;
  };

  // GET /api/storage/connect?space=<id>[&hint=<email>][&return=/s/…]
  const startConnect = apiRoute(async (req: Request): Promise<Response> => {
    const user = await deps.auth(req);
    if (user instanceof Response) return user;
    const cfg = deps.config();
    const params = new URL(req.url).searchParams;
    const space = await adminSpace(user.id, params.get("space") || null);
    if (!space) return goTo(cfg, REFUSED_PAGE);
    // No storage for a personal space while personal spaces are not offered: on to its coming-soon page.
    if (space.kind === "personal" && !personalSpacesOpen()) return goTo(cfg, `/s/${slugFor(space)}`);
    // A typed or kept link too: nobody is sent to Google for a connect this server can't finish.
    if (!cfg || block(space.kind) !== null) return goTo(cfg, storagePage(space, "not-configured"));

    const state = randomBytes(32).toString("base64url");
    const { verifier, challenge } = pkcePair();
    const back = returnPath(params.get("return"));
    const started: Started = { state, verifier, userId: user.id, spaceId: space.id, exp: now().getTime() + LIFE_SECONDS * 1000, ...(back ? { return: back } : {}) };
    const hint = params.get("hint");
    const location = authorizeUrl(cfg, { state, codeChallenge: challenge, ...(hint && EMAIL.test(hint) ? { loginHint: hint } : {}) });
    return new Response(null, {
      status: 302,
      headers: { location, "set-cookie": cookieLine(req, seal(JSON.stringify(started), cfg.tokenKey), COOKIE_SECONDS), "cache-control": "no-store" },
    });
  });
  const connect = async (req: Request): Promise<Response> => asPage(deps.config(), await startConnect(req));

  // Everything after the person is known: the cookie checked, what Google answered, the code exchanged, the connection
  // saved. Nothing is stored until the code is exchanged and drive.file was granted.
  async function finish(req: Request, cfg: StorageConfig, user: CurrentUser): Promise<Response> {
    const params = new URL(req.url).searchParams;
    const started = unseal(cookieFrom(req), cfg.tokenKey);
    const state = params.get("state");
    const refused = () => goTo(cfg, REFUSED_PAGE);
    if (!started || !state || !sameState(state, started.state) || started.userId !== user.id) return refused();
    const space = await adminSpace(user.id, started.spaceId);
    if (!space) return refused();
    // Took too long on Google's screen: the cookie is ours, theirs and for a space they still run, so back to it.
    if (started.exp <= now().getTime()) return goTo(cfg, storagePage(space, "expired"));

    const go = (path: string) => goTo(cfg, path);
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
      // A space whose videos are already in another account keeps its storage, and is told so in its own words; so is
      // a Google account that already backs another space.
      const code = failure instanceof ServiceError ? failure.code : null;
      return go(storagePage(space, code === "STORAGE_IN_USE" ? "in-use" : code === "ACCOUNT_IN_USE" ? "account-in-use" : "failed"));
    }
    return go((started.return && returnPath(started.return)) || storagePage(space, "connected"));
  }

  // GET /api/storage/callback?code&state (or ?error&state).
  const answer = apiRoute(async (req: Request): Promise<Response> => {
    const user = await deps.auth(req);
    if (user instanceof Response) return user;
    const cfg = deps.config();
    return cfg ? finish(req, cfg, user) : goTo(cfg, REFUSED_PAGE);
  });
  // Every answer is a page and clears the cookie, a failure too: it is used once.
  const callback = async (req: Request): Promise<Response> => {
    const res = asPage(deps.config(), await answer(req));
    const headers = new Headers(res.headers);
    headers.append("set-cookie", cookieLine(req, "", 0));
    return new Response(null, { status: res.status, headers });
  };

  return { connect, callback };
}
