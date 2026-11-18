import { randomBytes } from "node:crypto";
import type { SocialConfig } from "@/lib/social/config";
import { YOUTUBE_READ_SCOPE, YOUTUBE_UPLOAD_SCOPE, type Channel } from "@/lib/social/youtube-api";

export const SOCIAL_BASE = "https://app.test";

export const socialTestConfig = (): SocialConfig => ({
  clientId: "yt-client",
  clientSecret: "yt-secret",
  tokenKey: randomBytes(32),
  redirectUri: `${SOCIAL_BASE}/api/social/youtube/callback`,
});

type Session = { size: number; received: number; videoId: string; canceled: boolean; origin: string | null; body: unknown; token: string | null };

// A pretend Google for a YouTube channel: the token address (a code, a refresh, a revoke), the channel read, and
// upload sessions. What it grants and how it fails can be changed per test.
export function fakeYoutube(cfg: SocialConfig) {
  const grant = {
    scope: `openid https://www.googleapis.com/auth/userinfo.email ${YOUTUBE_UPLOAD_SCOPE} ${YOUTUBE_READ_SCOPE}`,
    sub: "g-yt-1",
    email: "team@gmail.com",
    refreshToken: "1//yt-refresh-1",
  };
  const world = {
    grant,
    channel: { id: "UC123", title: "Seattle Solvers" } as Channel | null,
    channelRefusal: null as { status: number; reason: string } | null,
    exchangeRefusal: null as string | null, // the token address's `error` for a code
    refreshRefusal: null as string | null, // the token address's `error` for a refresh ("invalid_grant")
    openRefusal: null as { status: number; reason: string } | null,
    statusAnswersId: true, // whether a finished upload's status answer names the video
    statusRefusal: null as number | null, // a status the session answers every status question with (400: it won't say)
    videos: new Map<string, string>(), // a video's channel, for ids that are not a session's own (those are on `channel`)
    sessions: new Map<string, Session>(),
    exchanges: [] as URLSearchParams[],
    refreshes: [] as string[],
    revoked: [] as string[],
    calls: [] as string[], // "<METHOD> <url without query>"
    // What a browser would do: `bytes` more of the file arrive at the session.
    receive(sessionUrl: string, bytes: number) {
      const session = world.sessions.get(sessionUrl);
      if (!session) throw new Error("no such session");
      session.received = Math.min(session.size, session.received + bytes);
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      world.calls.push(`${request.method} ${url.origin}${url.pathname}`);
      const refusal = (status: number, reason: string) => Response.json({ error: { code: status, errors: [{ reason }] } }, { status });

      if (request.url === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(await request.text());
        if (form.get("grant_type") === "authorization_code") {
          world.exchanges.push(form);
          if (world.exchangeRefusal) return Response.json({ error: world.exchangeRefusal }, { status: 400 });
          const claims = { iss: "https://accounts.google.com", aud: cfg.clientId, sub: grant.sub, email: grant.email, email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 };
          const idToken = `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
          return Response.json({ access_token: "ya29.from-code", refresh_token: grant.refreshToken, expires_in: 3600, scope: grant.scope, id_token: idToken, token_type: "Bearer" });
        }
        world.refreshes.push(form.get("refresh_token") ?? "");
        if (world.refreshRefusal) return Response.json({ error: world.refreshRefusal }, { status: 400 });
        return Response.json({ access_token: `ya29.for.${form.get("refresh_token")}`, expires_in: 3600, token_type: "Bearer" });
      }
      if (request.url === "https://oauth2.googleapis.com/revoke") {
        world.revoked.push(new URLSearchParams(await request.text()).get("token") ?? "");
        return new Response(null, { status: 200 });
      }
      if (url.origin + url.pathname === "https://www.googleapis.com/youtube/v3/channels") {
        if (world.channelRefusal) return refusal(world.channelRefusal.status, world.channelRefusal.reason);
        return Response.json({ items: world.channel ? [{ id: world.channel.id, snippet: { title: world.channel.title } }] : [] });
      }
      if (url.origin + url.pathname === "https://www.googleapis.com/youtube/v3/videos") {
        const id = url.searchParams.get("id") ?? "";
        const own = [...world.sessions.values()].some((session) => session.videoId === id && session.received >= session.size);
        const channelId = world.videos.get(id) ?? (own ? world.channel?.id : undefined);
        return Response.json({ items: channelId ? [{ id, snippet: { channelId } }] : [] });
      }
      if (url.origin + url.pathname === "https://www.googleapis.com/upload/youtube/v3/videos") {
        const id = url.searchParams.get("upload_id");
        if (request.method === "POST" && id === null) {
          if (world.openRefusal) return refusal(world.openRefusal.status, world.openRefusal.reason);
          const n = world.sessions.size + 1;
          const address = `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=session-${n}`;
          world.sessions.set(address, {
            size: Number(request.headers.get("x-upload-content-length")),
            received: 0,
            videoId: `video${String(n).padStart(6, "0")}`, // eleven characters
            canceled: false,
            origin: request.headers.get("origin"),
            body: await request.json(),
            token: request.headers.get("authorization"),
          });
          return new Response(null, { status: 200, headers: { location: address } });
        }
        const session = world.sessions.get(request.url);
        if (!session) return new Response(null, { status: 404 });
        if (request.method === "DELETE") {
          session.canceled = true;
          return new Response(null, { status: 499 });
        }
        if (session.canceled) return new Response(null, { status: 499 });
        if (world.statusRefusal !== null) return refusal(world.statusRefusal, "badRequest");
        if (session.received >= session.size) return Response.json(world.statusAnswersId ? { id: session.videoId } : {}, { status: 201 });
        return new Response(null, { status: 308, headers: session.received > 0 ? { range: `bytes=0-${session.received - 1}` } : {} });
      }
      throw new Error(`unexpected call to ${request.url}`);
    }) as typeof fetch,
  };
  return world;
}
