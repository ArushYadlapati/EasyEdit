import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "@/proxy";

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe("proxy", () => {
  it("runs on app pages and app API routes", () => {
    for (const url of ["/dashboard", "/admin", "/editor/abc", "/api/projects", "/api/projects/abc/ops", "/api/projects/abc/thumbnail", "/loginx", "/consent", "/privacyx", "/termsx"]) {
      expect(matches(url), url).toBe(true);
    }
  });

  it("skips login, auth, MCP, well-known, Next internals and static files", () => {
    for (const url of [
      "/login",
      "/api/auth/callback/google",
      "/api/auth/sign-in/social",
      "/api/mcp",
      "/api/mcp/sse",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource/api/mcp",
      "/_next/static/chunks/main.js",
      "/_next/image",
      "/favicon.ico",
      "/next.svg",
    ]) {
      expect(matches(url), url).toBe(false);
    }
  });

  it("redirects a page request without a session cookie to /login", () => {
    const res = proxy(new NextRequest("http://localhost:3000/dashboard"));
    expect(getRedirectUrl(res)).toBe("http://localhost:3000/login");
  });

  it("answers an API request without a session cookie with 401 UNAUTHENTICATED", async () => {
    const res = proxy(new NextRequest("http://localhost:3000/api/projects"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  });

  it("lets a request with a session cookie through to the real guard", () => {
    const req = new NextRequest("http://localhost:3000/dashboard", {
      headers: { cookie: "better-auth.session_token=abc" },
    });
    const res = proxy(req);
    expect(getRedirectUrl(res)).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("skips the home page, the privacy page and the terms page, which the pages themselves guard", () => {
    for (const url of ["/", "/privacy", "/terms"]) expect(matches(url), url).toBe(false);
  });

  it("skips the invite page, which renders signed out and asks the person to sign in itself", () => {
    for (const url of ["/invite/abc", "/invite/abc123XYZ"]) expect(matches(url), url).toBe(false);
    expect(matches("/invitex"), "/invitex").toBe(true);
  });

  // Reached by navigating (and by Google sending the browser back): the handlers turn a signed-out visitor into a page
  // themselves, so the proxy's 401 JSON must not answer first.
  it("skips the storage connect routes, which authenticate and redirect themselves", () => {
    for (const url of ["/api/storage/connect?space=team_x", "/api/storage/callback?code=c&state=s", "/api/storage"]) expect(matches(url), url).toBe(false);
    for (const url of ["/api/storagex", "/api/drive/read-token", "/api/media"]) expect(matches(url), url).toBe(true);
  });

});
