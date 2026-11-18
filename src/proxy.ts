import { getSessionCookie } from "better-auth/cookies";
import { UNAUTHENTICATED_BODY } from "@/lib/api-errors";
import { NextResponse, type NextRequest } from "next/server";

// The home page (/), /privacy, /terms and /invite/<id> are public: the matcher skips them, and the home page sends a signed-in person on to the dashboard itself.
// A quick first filter on cookie presence only. Pages and API routes still call requireUser/requireUserApi.
// /api/storage/* (connecting Google Drive) is skipped too: the browser navigates there, and back from Google, so its
// handlers check the session themselves and send a signed-out visitor to a page instead of this 401 JSON.
// So are /api/social/youtube/connect and /callback (connecting a YouTube channel), for the same reason.
// /api/cron/* (Vercel's scheduled jobs) carries no session: each handler checks the CRON_SECRET itself.
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(UNAUTHENTICATED_BODY, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/((?!$|privacy(?:/|$)|terms(?:/|$)|invite/|login(?:/|$)|api/auth(?:/|$)|api/mcp(?:/|$)|api/storage(?:/|$)|api/social/youtube/(?:connect|callback)(?:/|$)|api/cron(?:/|$)|\\.well-known(?:/|$)|_next/|.*\\.[^/]*$).*)",
  ],
};
