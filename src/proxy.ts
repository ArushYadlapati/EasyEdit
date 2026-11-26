import { getSessionCookie } from "better-auth/cookies";
import { UNAUTHENTICATED_BODY } from "@/lib/api-errors";
import { NextResponse, type NextRequest } from "next/server";

// A quick first filter on cookie presence only, for the app's own pages and its API. Pages and API routes still call
// requireUser/requireUserApi themselves.
// It runs only on the pages that need someone signed in (the matcher lists them: the dashboard, the editor, Admin, the
// AI agents page, Learn, the welcome, the consent page and /new, which makes the home page's first project), and
// sends a signed-out visitor to /login (from /new with a way back to it, so the project is still made after signing
// in). Every other address is left alone: the home page, sign-in, terms, privacy and /invite/<id> are public, and
// an address that matches no page shows the 404 page, not the sign-in page.
// /api/auth/* (sign-in itself) and /api/mcp (agents bring their own token) are skipped, and so is /api/storage/*
// (connecting Google Drive): the browser navigates there, and back from Google, so its handlers check the session
// themselves and send a signed-out visitor to a page instead of this 401 JSON. So are /api/social/youtube/connect and
// /callback (connecting a YouTube channel), for the same reason. /api/cron/* (Vercel's scheduled jobs) carries no
// session: each handler checks the CRON_SECRET itself.
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(UNAUTHENTICATED_BODY, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (request.nextUrl.pathname === "/new") login.searchParams.set("next", "/new");
  return NextResponse.redirect(login);
}

// The pages under src/app/(dashboard), src/app/(editor), src/app/(auth)/consent and src/app/new. /s/<space> is a
// space's projects and settings, and its editor under (editor). A new signed-in page outside these needs its own
// line here.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/agents/:path*",
    "/learn/:path*",
    "/welcome/:path*",
    "/consent/:path*",
    "/new",
    "/s/:path*",
    "/editor/:path*",
    "/api/((?!auth(?:/|$)|mcp(?:/|$)|storage(?:/|$)|social/youtube/(?:connect|callback)(?:/|$)|cron(?:/|$)).*)",
  ],
};
