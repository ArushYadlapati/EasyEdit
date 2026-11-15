import { getSessionCookie } from "better-auth/cookies";
import { UNAUTHENTICATED_BODY } from "@/lib/api-errors";
import { NextResponse, type NextRequest } from "next/server";

// The home page (/) and /privacy are public: the matcher skips them, and the home page sends a signed-in person on to the dashboard itself.
// A quick first filter on cookie presence only. Pages and API routes still call requireUser/requireUserApi.
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(UNAUTHENTICATED_BODY, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/((?!$|privacy(?:/|$)|login(?:/|$)|api/auth(?:/|$)|api/mcp(?:/|$)|\\.well-known(?:/|$)|_next/|.*\\.[^/]*$).*)",
  ],
};
