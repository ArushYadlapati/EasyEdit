import { requireMcpAuth } from "@better-auth/mcp";
import { eq } from "drizzle-orm";
import { createMcpHandler } from "mcp-handler";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import { resolveCurrentUser, type CurrentUser } from "@/lib/access-rules";
import { getAuth } from "@/lib/auth";
import type { AgentKind } from "@/lib/connector/agents";
import { refusalResponse, resolveConnectorCaller } from "@/lib/connector/caller";
import { appBaseUrl, mcpResourceUrl } from "@/lib/connector/config";
import { isAgentToken, resolveAgentToken } from "@/lib/connector/tokens";
import { toolContextFor } from "@/lib/mcp/context";
import { SERVER_INSTRUCTIONS } from "@/lib/mcp/guide";
import { registerTools } from "@/lib/mcp/server";

// The one place a bearer token is accepted. It never reads the session cookie and has no cross-origin rule:
// a browser never sends a bearer token on its own. The website's routes keep apiRoute and never accept one.
// Two kinds of token: an OAuth access token from the sign-in server (Claude, ChatGPT, Cursor and the rest), and a
// member's personal access token (ee_at_…) for an agent that can only send a header.
export const maxDuration = 30;

// Only POST: each request stands alone, and Next answers every other method with 405.
export function POST(request: Request): Promise<Response> {
  const bearer = bearerToken(request);
  if (bearer !== null && isAgentToken(bearer)) return withAccessToken(request, bearer);
  return requireMcpAuth(
    getAuth(),
    async (req, claims) => {
      // The token says who is calling. Whether they may use EasyEdit and the grant, read now, decide whether they may.
      const caller = await resolveConnectorCaller(getDb(), claims);
      if (!caller.ok) return refusalResponse(caller.reason);
      return serve(req, caller.user, caller.agent);
    },
    { resource: mcpResourceUrl() },
  )(request);
}

// The same server for both kinds of token, acting for the member through the named agent.
async function serve(request: Request, member: CurrentUser, agent: AgentKind): Promise<Response> {
  const ctx = await toolContextFor(member, agent);
  const handler = createMcpHandler((server) => registerTools(server, ctx), {
    serverInfo: { name: "easyedit", version: "1.0.0" },
    instructions: SERVER_INSTRUCTIONS,
  });
  return handler(request);
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer +(\S+) *$/i.exec(request.headers.get("authorization") ?? "");
  return match === null ? null : match[1];
}

// A personal access token: it must be known and unexpired, and its member still allowed in (resolveCurrentUser), checked now.
async function withAccessToken(request: Request, token: string): Promise<Response> {
  const db = getDb();
  const resolved = await resolveAgentToken(db, token);
  if (resolved === null) return unknownTokenResponse();
  const [row] = await db
    .select({ id: user.id, email: user.email, name: user.name, image: user.image })
    .from(user)
    .where(eq(user.id, resolved.userId));
  const member = row === undefined ? null : await resolveCurrentUser(db, row);
  if (member === null) return refusalResponse("not-allowlisted");
  return serve(request, member, resolved.agent);
}

// A revoked, expired or mistyped token. The challenge also names where to sign in, for an agent that can.
function unknownTokenResponse(): Response {
  const message = "This access token isn't valid: it was revoked, it expired or it was copied wrong. Make a new one on EasyEdit's AI agents page.";
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer error="invalid_token", error_description="The access token is not valid", resource_metadata="${appBaseUrl()}/.well-known/oauth-protected-resource/api/mcp"`,
    },
  });
}
