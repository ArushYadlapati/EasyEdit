import { APIError, createAuthMiddleware, type AuthMiddleware } from "better-auth/api";
import { getDb } from "@/db";
import { isAllowedRedirect } from "@/lib/connector/agents";
import { pruneUnusedClients } from "@/lib/connector/grants";

// The OAuth provider's dynamic client registration endpoint (RFC 7591), under /api/auth.
export const REGISTER_PATH = "/oauth2/register";

// Registration fields an agent may not set: skipping the consent page, and a back-channel logout target, which would
// have the sign-in server post to an outside address. The provider refuses skip_consent too; this does not rely on it.
const REFUSED_REGISTRATION_FIELDS = ["skip_consent", "backchannel_logout_uri", "backchannel_logout_session_required"] as const;

// Registration fields EasyEdit never uses. Agents send some of them (VS Code sends client_uri), so they are dropped
// rather than refused, and an unauthenticated caller cannot store them on a row that every MCP call and page reads.
export const STRIPPED_REGISTRATION_FIELDS = [
  "logo_uri", "client_uri", "policy_uri", "tos_uri", "contacts", "software_statement", "software_id", "software_version",
  "jwks", "jwks_uri", "post_logout_redirect_uris", "sector_identifier_uri", "initiate_login_uri", "request_uris",
] as const;

// Registration is open to anyone, so what it may store is bounded. A real agent sends well under a kilobyte.
export const MAX_REGISTRATION_BYTES = 16 * 1024;
export const MAX_REDIRECT_URIS = 10;
export const MAX_REDIRECT_URI_LENGTH = 512;
export const MAX_CLIENT_NAME_LENGTH = 100;

function refuse(error: string, description: string): never {
  throw new APIError("BAD_REQUEST", { error, error_description: description });
}

// An agent registering itself lists at least one redirect address, and every one is an address a known agent uses or
// a loopback address on the member's own computer, so a sign-in code can only ever reach the agent the member chose.
// Grant types and scopes stay the provider's to limit: it keeps only authorization_code and refresh_token, and the
// scopes it allows. Returns the body without the fields EasyEdit drops.
export function checkRegistration(body: unknown): Record<string, unknown> {
  const fields: Record<string, unknown> = typeof body === "object" && body !== null ? { ...body } : {};
  if (Buffer.byteLength(JSON.stringify(fields)) > MAX_REGISTRATION_BYTES) {
    refuse("invalid_client_metadata", `The registration is larger than ${MAX_REGISTRATION_BYTES} bytes.`);
  }
  const uris = fields.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    refuse("invalid_redirect_uri", "Every redirect URI must be one a known AI agent uses, or a loopback address.");
  }
  if (uris.length > MAX_REDIRECT_URIS) refuse("invalid_client_metadata", `List at most ${MAX_REDIRECT_URIS} redirect URIs.`);
  if (uris.some((uri) => typeof uri === "string" && uri.length > MAX_REDIRECT_URI_LENGTH)) {
    refuse("invalid_client_metadata", `Each redirect URI must be at most ${MAX_REDIRECT_URI_LENGTH} characters.`);
  }
  if (!uris.every((uri) => typeof uri === "string" && isAllowedRedirect(uri))) {
    refuse("invalid_redirect_uri", "Every redirect URI must be one a known AI agent uses, or a loopback address.");
  }
  if (typeof fields.client_name === "string" && fields.client_name.length > MAX_CLIENT_NAME_LENGTH) {
    refuse("invalid_client_metadata", `client_name must be at most ${MAX_CLIENT_NAME_LENGTH} characters.`);
  }
  for (const field of REFUSED_REGISTRATION_FIELDS) {
    if (fields[field] !== undefined) refuse("invalid_client_metadata", `${field} cannot be set during registration`);
  }
  for (const field of STRIPPED_REGISTRATION_FIELDS) delete fields[field];
  return fields;
}

// Better Auth merges a body a hook returns into the request's own body, and fills back in any field the returned body
// leaves out, so returning the cleaned body would drop nothing. The registration endpoint validates and stores the
// request's own body object, so the fields are deleted from that object.
function keepOnly(target: Record<string, unknown>, cleaned: Record<string, unknown>): void {
  for (const key of Object.keys(target)) if (!Object.hasOwn(cleaned, key)) delete target[key];
}

// Agents that register and never connect leave a row behind. Old ones go here rather than on a schedule. A failure
// only leaves them for the next registration, so it never stops this one.
async function pruneQuietly(): Promise<void> {
  try {
    await pruneUnusedClients(getDb());
  } catch {
    // Housekeeping only: the next registration tries again. Nothing in the connector logs except the tool wrapper.
  }
}

// The requested prompt without "none", plus "consent": the member always sees the consent page.
function promptWithConsent(prompt: unknown): string {
  const values = [prompt].flat().filter((v) => typeof v === "string").flatMap((v) => v.split(" "));
  return [...new Set([...values.filter((v) => v !== "" && v !== "none"), "consent"])].join(" ");
}

// The browser's request was the consent page's answer: Allow or Don't allow.
function fromConsentEndpoint(request: Request | undefined): boolean {
  return request !== undefined && new URL(request.url).pathname.endsWith("/oauth2/consent");
}

// Runs before every /api/auth request and acts only on registration and authorization.
export function connectorBeforeHook(): AuthMiddleware {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path === REGISTER_PATH) {
      const cleaned = checkRegistration(ctx.body);
      await pruneQuietly();
      keepOnly(ctx.body, cleaned);
      return;
    }
    // Every entry into authorization asks for consent: the authorize address itself, and the library's re-entries after
    // Google sign-in and from /oauth2/continue, which carry the browser's own address. The one exception is the consent
    // endpoint's re-entry after the member decides, where asking again would never end. Authorization reads a direct
    // form post from its body and everything else from its query, so the prompt is set in both.
    if (ctx.path === "/oauth2/authorize" && !fromConsentEndpoint(ctx.request)) {
      return {
        context: {
          query: { ...ctx.query, prompt: promptWithConsent(ctx.query?.prompt) },
          body: { ...ctx.body, prompt: promptWithConsent(ctx.body?.prompt) },
        },
      };
    }
  });
}
