import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "@/proxy";

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

// The pages a signed-out visitor may open; every other page under src/app needs someone signed in.
const PUBLIC_PAGES = ["/", "/login", "/privacy", "/terms", "/invite/x"];

// Every page under src/app, as an address: route groups like (dashboard) dropped, each [param] filled with "x".
function appPages(): string[] {
  const root = join(process.cwd(), "src/app");
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(`${sep}page.tsx`) || file === "page.tsx")
    .map((file) => {
      const parts = file.split(sep).slice(0, -1);
      const segments = parts.filter((p) => !/^\(.*\)$/.test(p)).map((p) => (/^\[.*\]$/.test(p) ? "x" : p));
      return `/${segments.join("/")}`;
    });
}

describe("proxy", () => {
  it("runs on app pages and app API routes", () => {
    for (const url of [
      "/dashboard",
      "/admin",
      "/agents",
      "/learn",
      "/welcome",
      "/consent",
      "/s/seattle-solvers",
      "/s/seattle-solvers/settings/members",
      "/s/seattle-solvers/editor/abc",
      "/editor/abc",
      "/api/projects",
      "/api/projects/abc/ops",
      "/api/projects/abc/thumbnail",
      "/api/x",
      "/api/cronx",
    ]) {
      expect(matches(url), url).toBe(true);
    }
  });

  it("runs on every page under src/app that needs someone signed in, and on none of the public ones", () => {
    const pages = appPages();
    expect(pages).toEqual(expect.arrayContaining(["/dashboard", "/s/x/settings/members", "/s/x/editor/x", ...PUBLIC_PAGES]));
    for (const page of pages) expect(matches(page), page).toBe(!PUBLIC_PAGES.includes(page));
  });

  it("lets an address that matches no page through, so a signed-out visitor sees the 404 page", () => {
    for (const url of ["/some-unknown-page", "/loginx", "/privacyx", "/termsx", "/dashboardx", "/editors", "/invitex", "/tutorial", "/api", "/a/b/c"]) {
      expect(matches(url), url).toBe(false);
    }
  });

  it("skips login, auth, MCP, well-known, Next internals and static files", () => {
    for (const url of [
      "/login",
      "/api/auth/callback/google",
      "/api/auth/sign-in/social",
      "/api/mcp",
      "/api/mcp/sse",
      "/api/cron/db-size",
      "/api/cron/style-trim",
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
  });

  it("redirects every signed-in page's address to /login without a session cookie, and answers any API route with 401", async () => {
    for (const url of ["/dashboard", "/s/seattle-solvers/editor/abc", "/consent?client_id=c1"]) {
      expect(getRedirectUrl(proxy(new NextRequest(`http://localhost:3000${url}`))), url).toBe("http://localhost:3000/login");
    }
    // /new makes the home page's first project, so sign-in comes back to it.
    expect(getRedirectUrl(proxy(new NextRequest("http://localhost:3000/new")))).toBe("http://localhost:3000/login?next=%2Fnew");
    const res = proxy(new NextRequest("http://localhost:3000/api/x"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  });

  // Reached by navigating (and by Google sending the browser back): the handlers turn a signed-out visitor into a page
  // themselves, so the proxy's 401 JSON must not answer first.
  it("skips the storage connect routes, which authenticate and redirect themselves", () => {
    for (const url of ["/api/storage/connect?space=team_x", "/api/storage/callback?code=c&state=s", "/api/storage"]) expect(matches(url), url).toBe(false);
    for (const url of ["/api/storagex", "/api/drive/read-token", "/api/media"]) expect(matches(url), url).toBe(true);
  });

});
