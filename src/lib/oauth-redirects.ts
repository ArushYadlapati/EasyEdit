import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

// What the routes that send a person to Google and take them back share (connecting a Drive, connecting a YouTube
// channel): the cookie a started connect is kept in, the state check, and answers that are always a redirect to a
// page of this app.

// The cookie a started connect is kept in, and the only routes that get it.
export type OAuthCookie = { name: string; path: string };

const firstValue = (value: string | null) => value?.split(",")[0].trim() || null;
const isHttps = (req: Request) => (firstValue(req.headers.get("x-forwarded-proto")) ?? new URL(req.url).protocol.slice(0, -1)) === "https";

export function cookieLine(req: Request, cookie: OAuthCookie, value: string, maxAge: number): string {
  return `${cookie.name}=${value}; Path=${cookie.path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isHttps(req) ? "; Secure" : ""}`;
}

export function cookieFrom(req: Request, name: string): string | null {
  for (const pair of (req.headers.get("cookie") ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim() || null;
  }
  return null;
}

// Both hashed first, so the comparison takes as long whatever the lengths.
export function sameState(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

// A redirect to a path of this app: on the configured address when there is one (never the request's Host), else as a
// path the browser resolves against the address it used. `redirectUri`: the configured callback address, or null.
export function redirectTo(redirectUri: string | null, path: string): Response {
  const location = redirectUri ? new URL(path, new URL(redirectUri).origin).toString() : path;
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}

// Anything that is not already a redirect (a signed-out or role answer, apiRoute's 500) becomes one to a fixed page.
export function pageAnswer(redirectUri: string | null, res: Response, pages: { failed: string; refused: string }): Response {
  if (res.status >= 300 && res.status < 400 && res.headers.has("location")) return res;
  return redirectTo(redirectUri, res.status >= 500 ? pages.failed : pages.refused);
}
