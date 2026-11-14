import "server-only";
import { desc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { oauthClient, oauthConsent } from "@/db/schema";
import { guessAgentKind, type AgentKind } from "@/lib/connector/agents";

// One agent a member let in by signing in (OAuth), for the AI agents page.
export type AgentConnection = {
  clientId: string;
  clientName: string | null; // what the client calls itself; untrusted text, shown as is
  agent: AgentKind;
  connectedAt: Date;
};

// The redirect addresses as the driver hands them back: a text array, or JSON text from an older or other driver.
function uriList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((uri): uri is string => typeof uri === "string");
  if (typeof value !== "string") return [];
  try {
    return uriList(JSON.parse(value));
  } catch {
    return [];
  }
}

// Every client the member allowed, newest first, one row per client.
export async function listAgentConnections(db: DB, userId: string): Promise<AgentConnection[]> {
  const rows = await db
    .select({
      clientId: oauthConsent.clientId,
      name: oauthClient.name,
      redirectUris: oauthClient.redirectUris,
      connectedAt: oauthConsent.createdAt,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.createdAt), desc(oauthConsent.id));

  const seen = new Set<string>();
  const connections: AgentConnection[] = [];
  for (const row of rows) {
    if (seen.has(row.clientId)) continue;
    seen.add(row.clientId);
    const clientName = row.name?.trim() || null;
    connections.push({
      clientId: row.clientId,
      clientName,
      agent: guessAgentKind({ clientId: row.clientId, name: clientName, redirectUris: uriList(row.redirectUris) }),
      connectedAt: row.connectedAt,
    });
  }
  return connections;
}
