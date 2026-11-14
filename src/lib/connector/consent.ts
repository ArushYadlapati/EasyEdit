import "server-only";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { oauthClient } from "@/db/schema";
import {
  agentForClientDocument,
  agentForRedirect,
  agentName as nameOfAgent,
  guessAgentKind,
  isLoopbackRedirect,
  type AgentKind,
} from "@/lib/connector/agents";
import { graphemes } from "@/lib/text";

export type SearchParams = Record<string, string | string[] | undefined>;

// Where the member's browser goes with the sign-in code after they allow: a program on their own computer (a loopback
// address), a known agent's website, or a known agent's own app.
export type ConsentDestination =
  | { kind: "this-computer"; port: number }
  | { kind: "web"; host: string }
  | { kind: "app"; name: string };

export type ConsentView = {
  // The name the app gave itself, cleaned up, or null when it gave none. Anyone can register any name: never shown as
  // a fact.
  clientName: string | null;
  // The host that serves the app's metadata document, for an app known by one.
  verifiedHost: string | null;
  // The agent the editor's change list will name, guessed the same way the MCP server guesses it. Wording only.
  agent: AgentKind;
  // Whether EasyEdit knows which agent this is from facts: the address of its metadata document on a known agent's
  // host, or a callback address only that agent uses. Never from the name an app gave itself.
  nameVerified: boolean;
  // What the page calls the app. The agent's own name when nameVerified; otherwise the app as it describes itself,
  // starting lower case to sit inside a sentence: "an app that calls itself “Helper”", or "an unnamed app".
  agentName: string;
  destination: ConsentDestination;
};
export type ConsentRequest = { ok: true; view: ConsentView } | { ok: false };

const MAX_CLIENT_NAME = 60;
const UNNAMED_APP = "an unnamed app";

// The sign-in server signs the request it sends to the login and consent pages.
export function isConnectorRequest(searchParams: SearchParams): boolean {
  return searchParams.sig !== undefined;
}

function toQuery(searchParams: SearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const v of typeof value === "string" ? [value] : value ?? []) query.append(key, v);
  }
  return query.toString();
}

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

// A name an app gave itself, made safe to show inside quotes: no invisible formatting (bidi controls such as U+202E,
// U+2066–U+2069, U+200E, U+200F and U+061C, zero-width characters U+200B–U+200D and U+FEFF), no control characters, one
// space between words, and at most MAX_CLIENT_NAME characters. Null when nothing is left.
export function cleanClientName(raw: string | null | undefined): string | null {
  const text = (raw ?? "")
    // Every format character (\p{Cf}) is invisible; the bidi and zero-width ones above are all among them.
    .replace(/\p{Cf}/gu, "")
    .replace(/\s/gu, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
  if (text === "") return null;
  return graphemes(text).slice(0, MAX_CLIENT_NAME).join("").trimEnd();
}

// The agent a metadata document's address names, as agentForClientDocument in ./agents decides it, but a document on a
// host EasyEdit does not tie to one agent ("other") names no agent.
function agentForDocument(clientId: string): AgentKind | null {
  const kind = agentForClientDocument(clientId);
  return kind === "other" ? null : kind;
}

// Where the code goes, from the redirect address in the signed request. Null for an address that is neither on the
// member's own computer nor one of a known agent's: the sign-in server never signs such a request.
function destinationOf(redirectUri: string): ConsentDestination | null {
  const url = parseUrl(redirectUri);
  if (url === null) return null;
  if (isLoopbackRedirect(redirectUri)) return { kind: "this-computer", port: url.port === "" ? 80 : Number(url.port) };
  const agent = agentForRedirect(redirectUri);
  if (agent === null) return null;
  if (url.protocol === "https:") return { kind: "web", host: url.host };
  if (url.protocol === "http:") return null;
  return { kind: "app", name: nameOfAgent(agent) };
}

// What the consent page may show, only for a request this server signed and that has not expired.
export async function readConsentRequest(db: DB, secret: string, searchParams: SearchParams): Promise<ConsentRequest> {
  const { client_id: clientId, redirect_uri: redirectUri } = searchParams;
  if (typeof clientId !== "string" || typeof redirectUri !== "string") return { ok: false };
  if (!(await verifyOAuthQueryParams(toQuery(searchParams), secret))) return { ok: false };
  const destination = destinationOf(redirectUri);
  if (destination === null) return { ok: false };
  const [row] = await db
    .select({ name: oauthClient.name, discoveryId: oauthClient.clientDiscoveryId, redirectUris: oauthClient.redirectUris })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId));
  if (row === undefined) return { ok: false };

  const clientName = cleanClientName(row.name);
  // Only an app known by its metadata document is vouched for by the host that serves it.
  const documentUrl = row.discoveryId !== null ? parseUrl(clientId) : null;
  const verifiedHost = documentUrl?.host ?? null;
  // Facts only, in this order: the metadata document's address, then the callback the code goes to.
  const verifiedAgent = (documentUrl !== null ? agentForDocument(clientId) : null) ?? agentForRedirect(redirectUri);
  const agentName = verifiedAgent !== null
    ? nameOfAgent(verifiedAgent)
    : clientName !== null ? `an app that calls itself “${clientName}”` : UNNAMED_APP;
  // The same guess the MCP server makes for the change list, so the page names the agent the way the editor will.
  const agent = guessAgentKind({ clientId, name: row.name, redirectUris: row.redirectUris });
  return { ok: true, view: { clientName, verifiedHost, agent, nameVerified: verifiedAgent !== null, agentName, destination } };
}
