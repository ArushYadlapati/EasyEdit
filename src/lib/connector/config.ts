import { requiredEnv } from "@/lib/env";

// Which addresses a member may be sent back to, and which hosts' client metadata documents are read, come from the
// agent registry in ./agents (isAllowedRedirect and isAllowedClientDocument).

// AI agents may register themselves at /api/auth/oauth2/register, as Claude Code, Cursor, VS Code, Codex and Gemini CLI
// do. connectorBeforeHook refuses a registration unless every address it lists is one a known agent uses or a
// loopback address, and the consent page is shown whatever the registration says. Claude identifies itself by its
// metadata document instead.
export const DYNAMIC_REGISTRATION = true;

export function appBaseUrl(): string {
  return requiredEnv("BETTER_AUTH_URL").replace(/\/+$/, "");
}

// The one address the connector's access tokens are bound to.
export function mcpResourceUrl(): string {
  return `${appBaseUrl()}/api/mcp`;
}
