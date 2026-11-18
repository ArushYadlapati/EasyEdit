import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { apiRoute } from "@/lib/api-route";
import { DriveError } from "@/lib/drive/token";
import { cookieFrom, cookieLine, type OAuthCookie, pageAnswer, redirectTo, sameState } from "@/lib/oauth-redirects";
import { slugFor } from "@/lib/spaces/paths";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { listMySpaces } from "@/lib/spaces/service";
import type { MySpace } from "@/lib/spaces/types";
import { authorizeUrl, exchangeCode, OAuthError, pkcePair } from "@/lib/storage/google-oauth";
import { open, seal } from "@/lib/storage/secret-box";
import type { SocialConfig } from "./config";
import { saveYoutubeConnection } from "./connections";
import type { ConnectNote } from "./messages";
import { type Channel, myChannel, YOUTUBE_READ_SCOPE, YOUTUBE_UPLOAD_SCOPE } from "./youtube-api";

export type SocialConnectDeps = {
  db: () => DB;
  auth: (req: Request) => Promise<CurrentUser | Response>;
  config: () => SocialConfig | null;
  fetch?: typeof fetch;
  now?: () => Date;
};

// What the browser keeps between pressing "Connect a YouTube channel" and Google sending it back: sealed with the
// token key, so it can't be read or made up. Only the two connect routes get it.
export const SOCIAL_OAUTH_COOKIE = "ee_social_oauth";
const COOKIE: OAuthCookie = { name: SOCIAL_OAUTH_COOKIE, path: "/api/social/youtube" };
const LIFE_SECONDS = 600; // how long a started connect is good for (`exp`)
// The cookie outlives `exp`, so a connect that took too long can still be told apart from one never started here.
const COOKIE_SECONDS = 3600;

const startedShape = z.object({ state: z.string().min(1), verifier: z.string().min(1), userId: z.string().min(1), spaceId: z.string().min(1), exp: z.number() });
type Started = z.infer<typeof startedShape>;

// Both routes are reached by the browser navigating, so every answer is a redirect to a page, never JSON. Whatever
// can't be trusted to name a space lands on one fixed page.
const PAGES = { refused: "/dashboard?youtube=refused", failed: "/dashboard?youtube=failed", notSetUp: "/dashboard?youtube=not-configured" };

export const socialsPage = (space: MySpace, note?: ConnectNote) => `/s/${slugFor(space)}/settings/socials${note ? `?youtube=${note}` : ""}`;

function unseal(value: string | null, key: Uint8Array): Started | null {
  if (!value) return null;
  try {
    const parsed = startedShape.safeParse(JSON.parse(open(value, key)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Only an admin of a space connects a channel for it (a personal space's owner is its admin). Anyone else, and a
// space that doesn't exist, lands on the same fixed refused page.
export function makeSocialConnectHandlers(deps: SocialConnectDeps): { connect(req: Request): Promise<Response>; callback(req: Request): Promise<Response> } {
  const now = deps.now ?? (() => new Date());
  const fetchFn = deps.fetch ?? fetch;
  const goTo = (cfg: SocialConfig | null, path: string) => redirectTo(cfg?.redirectUri ?? null, path);
  const asPage = (cfg: SocialConfig | null, res: Response) => pageAnswer(cfg?.redirectUri ?? null, res, PAGES);
  const adminSpace = async (userId: string, spaceId: string | null): Promise<MySpace | null> => {
    if (!spaceId) return null;
    const space = (await listMySpaces(deps.db(), userId)).find((mine) => mine.id === spaceId) ?? null;
    if (space?.role !== "admin") return null;
    // A personal space has no settings while personal spaces are not offered.
    return space.kind === "personal" && !personalSpacesOpen() ? null : space;
  };

  // GET /api/social/youtube/connect?space=<id>
  const startConnect = apiRoute(async (req: Request): Promise<Response> => {
    const user = await deps.auth(req);
    if (user instanceof Response) return user;
    const cfg = deps.config();
    // Started from this app's own page (or a typed address), never from a link on another site: Google's screen
    // doesn't say which space a channel is being connected to.
    if (req.headers.get("sec-fetch-site") === "cross-site") return goTo(cfg, PAGES.refused);
    const space = await adminSpace(user.id, new URL(req.url).searchParams.get("space") || null);
    if (!space) return goTo(cfg, PAGES.refused);
    // A typed or kept link too: nobody is sent to Google for a connect this server can't finish. The Socials page
    // doesn't exist on such a server, so it is told on the space's dashboard.
    if (!cfg) return goTo(cfg, PAGES.notSetUp);

    const state = randomBytes(32).toString("base64url");
    const { verifier, challenge } = pkcePair();
    const started: Started = { state, verifier, userId: user.id, spaceId: space.id, exp: now().getTime() + LIFE_SECONDS * 1000 };
    // Google's account chooser every time: the channel is often not on the account the person signed in with.
    const location = authorizeUrl(cfg, { state, codeChallenge: challenge, scope: `openid email ${YOUTUBE_UPLOAD_SCOPE} ${YOUTUBE_READ_SCOPE}` });
    return new Response(null, {
      status: 302,
      headers: { location, "set-cookie": cookieLine(req, COOKIE, seal(JSON.stringify(started), cfg.tokenKey), COOKIE_SECONDS), "cache-control": "no-store" },
    });
  });
  const connect = async (req: Request): Promise<Response> => asPage(deps.config(), await startConnect(req));

  // Everything after the person is known: the cookie checked, what Google answered, the code exchanged, the channel
  // read, the connection saved. Nothing is stored until the code is exchanged and uploading was granted.
  async function finish(req: Request, cfg: SocialConfig, user: CurrentUser): Promise<Response> {
    const params = new URL(req.url).searchParams;
    const started = unseal(cookieFrom(req, SOCIAL_OAUTH_COOKIE), cfg.tokenKey);
    const state = params.get("state");
    if (!started || !state || !sameState(state, started.state) || started.userId !== user.id) return goTo(cfg, PAGES.refused);
    const space = await adminSpace(user.id, started.spaceId);
    if (!space) return goTo(cfg, PAGES.refused);
    const outcome = (note: ConnectNote) => goTo(cfg, socialsPage(space, note));
    // Took too long on Google's screen: the cookie is ours, theirs and for a space they still run, so back to it.
    if (started.exp <= now().getTime()) return outcome("expired");

    const error = params.get("error");
    if (error) return outcome(error === "access_denied" ? "cancelled" : "failed");
    const code = params.get("code");
    if (!code) return goTo(cfg, PAGES.refused);

    let granted: Awaited<ReturnType<typeof exchangeCode>>;
    try {
      granted = await exchangeCode(cfg, { code, codeVerifier: started.verifier }, fetchFn);
    } catch (failure) {
      if (!(failure instanceof DriveError || failure instanceof OAuthError)) throw failure;
      console.error("Connecting a YouTube channel failed:", failure.message);
      return outcome("failed");
    }
    // The person can untick a box on Google's screen. Without uploading there is nothing to connect.
    if (!granted.scopes.includes(YOUTUBE_UPLOAD_SCOPE)) return outcome("needs-upload");

    // The channel's name, when the person let EasyEdit read it. An account with no channel can't be posted to, so it
    // is not connected. A read that fails for another reason doesn't stop the connect: the page shows the address.
    let channel: Channel | null = null;
    if (granted.scopes.includes(YOUTUBE_READ_SCOPE)) {
      try {
        channel = await myChannel(granted.accessToken, fetchFn);
        if (channel === null) return outcome("no-channel");
      } catch (failure) {
        if (!(failure instanceof DriveError)) throw failure;
        console.error("Reading the YouTube channel failed:", failure.message);
      }
    }

    await saveYoutubeConnection(deps.db(), cfg, {
      spaceId: space.id,
      connectedBy: user.id,
      googleSub: granted.googleSub,
      email: granted.email,
      channel,
      refreshToken: granted.refreshToken,
      scopes: granted.scopes,
    });
    return outcome("connected");
  }

  // GET /api/social/youtube/callback?code&state (or ?error&state).
  const answer = apiRoute(async (req: Request): Promise<Response> => {
    const user = await deps.auth(req);
    if (user instanceof Response) return user;
    const cfg = deps.config();
    return cfg ? finish(req, cfg, user) : goTo(cfg, PAGES.refused);
  });
  // Every answer is a page and clears the cookie, a failure too: it is used once.
  const callback = async (req: Request): Promise<Response> => {
    const res = asPage(deps.config(), await answer(req));
    const headers = new Headers(res.headers);
    headers.append("set-cookie", cookieLine(req, COOKIE, "", 0));
    return new Response(null, { status: res.status, headers });
  };

  return { connect, callback };
}
