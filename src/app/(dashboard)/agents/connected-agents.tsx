"use client";

import { useState, type ReactNode } from "react";
import { LocalDate } from "./local-date";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@/components/ui/button";
import { agentName } from "@/lib/connector/agents";
import type { AgentActions, AgentConnection, AgentTokenSummary } from "./types";
import { useCall } from "./use-call";

type Asking = { kind: "client" | "token"; id: string; name: string };

const ROW = "flex min-w-0 items-center gap-3 px-3 py-2.5";
const KIND = "shrink-0 rounded-[4px] border border-ed-line px-1.5 text-[11px] leading-4 font-medium text-ed-muted";

// The agent's name, and the client's own name after it when that says something more ("Cursor · Cursor Desktop").
function connectionName(connection: AgentConnection): { agent: string; client: string | null } {
  const agent = agentName(connection.agent);
  const client = connection.clientName;
  return { agent, client: client !== null && client.toLowerCase() !== agent.toLowerCase() ? client : null };
}

function tokenDates(token: AgentTokenSummary, now: Date): ReactNode {
  const iso = (date: Date) => date.toISOString();
  return (
    <>
      Created <LocalDate iso={iso(token.createdAt)} />
      {" · "}
      {token.lastUsedAt === null ? "Never used" : <>Last used <LocalDate iso={iso(token.lastUsedAt)} /></>}
      {token.expiresAt !== null && (
        <>
          {" · "}
          {token.expiresAt.getTime() <= now.getTime() ? "Expired" : "Expires"} <LocalDate iso={iso(token.expiresAt)} />
        </>
      )}
    </>
  );
}

// What can act as the member: each agent they signed in to (one row per client) and access tokens. The page passes
// the tokens that have been used here, and lists the ones nothing has used yet with Access tokens (label, empty null:
// nothing is drawn when there are none). Disconnect and Revoke ask first; the dialog stays open with the reason when
// the action is refused.
export function ConnectedAgents({ connections, tokens, now, actions, label = "Connected agents", empty = "No agents connected yet." }: {
  connections: readonly AgentConnection[];
  tokens: readonly AgentTokenSummary[];
  now: Date;
  actions: Pick<AgentActions, "disconnect" | "revokeToken">;
  label?: string;
  empty?: string | null;
}): ReactNode {
  // What the dialog asks about, kept while it closes so its text does not change under it.
  const [asking, setAsking] = useState<Asking | null>(null);
  const [open, setOpen] = useState(false);
  const disconnect = useCall(actions.disconnect);
  const revoke = useCall(actions.revokeToken);
  const call = asking?.kind === "token" ? revoke : disconnect;

  function ask(next: Asking) {
    disconnect.clear();
    revoke.clear();
    setAsking(next);
    setOpen(true);
  }

  function confirm() {
    if (asking === null || call.pending) return;
    call.run([asking.id], { onSuccess: () => setOpen(false) });
  }

  const list = connections.length === 0 && tokens.length === 0 ? (
    empty === null ? null : <p className="text-[13px] text-ed-muted">{empty}</p>
  ) : (
    <ul aria-label={label} className="flex flex-col divide-y divide-ed-line rounded-md border border-ed-line bg-ed-panel">
      {connections.map((connection) => {
        const { agent, client } = connectionName(connection);
        const label = client === null ? agent : `${agent} (${client})`;
        return (
          <li key={`client:${connection.clientId}`} className={ROW}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="flex min-w-0 items-center gap-2 text-[13px] leading-5">
                <span className="shrink-0 font-medium text-ed-text">{agent}</span>
                {client !== null && <span className="min-w-0 truncate text-ed-muted">{client}</span>}
                <span className={KIND}>Signed in</span>
              </p>
              <p className="text-xs text-ed-muted">
                Connected <LocalDate iso={connection.connectedAt.toISOString()} />
              </p>
            </div>
            <Button
              variant="danger"
              aria-label={`Disconnect ${label}`}
              onClick={() => ask({ kind: "client", id: connection.clientId, name: label })}
            >
              Disconnect
            </Button>
          </li>
        );
      })}
      {tokens.map((token) => (
        <li key={`token:${token.id}`} className={ROW}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="flex min-w-0 items-center gap-2 text-[13px] leading-5">
              <span className="min-w-0 truncate font-medium text-ed-text">{token.name}</span>
              <span className="shrink-0 text-ed-muted">{agentName(token.agent)}</span>
              <span className={KIND}>Token</span>
            </p>
            <p className="text-xs text-ed-muted">
              <span className="font-mono">…{token.preview}</span>
              {" · "}
              {tokenDates(token, now)}
            </p>
          </div>
          <Button
            variant="danger"
            aria-label={`Revoke ${token.name}`}
            onClick={() => ask({ kind: "token", id: token.id, name: token.name })}
          >
            Revoke
          </Button>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {list}
      {asking !== null && (
        <ConfirmDialog
          title={asking.kind === "token" ? "Revoke token" : "Disconnect agent"}
          question={
            asking.kind === "token"
              ? `Revoke the token "${asking.name}"? Anything using it stops working right away.`
              : `Disconnect ${asking.name}? It can't reach EasyEdit until you connect it again.`
          }
          confirmLabel={asking.kind === "token" ? "Revoke" : "Disconnect"}
          open={open}
          pending={call.pending}
          error={call.error}
          onConfirm={confirm}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
