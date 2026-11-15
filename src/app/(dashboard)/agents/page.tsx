import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { mcpResourceUrl } from "@/lib/connector/config";
import { listAgentConnections } from "@/lib/connector/connections";
import { listAgentTokens, MAX_TOKEN_NAME } from "@/lib/connector/tokens";
import { listMySpaces } from "@/lib/spaces/service";
import { canChangeInAnySpace } from "@/lib/spaces/types";
import { createTokenAction, disconnectAgentAction, revokeTokenAction } from "./actions";
import { AgentsView } from "./agents-view";
import type { AgentActions } from "./types";

export const metadata: Metadata = { title: "AI agents" };

const ACTIONS: AgentActions = {
  disconnect: disconnectAgentAction,
  createToken: createTokenAction,
  revokeToken: revokeTokenAction,
};

// Where any member connects their AI agents, as many as they like, and sees and ends what is connected.
export default async function AgentsPage(): Promise<ReactNode> {
  // The page checks for itself: a layout is not run again on a client navigation.
  const me = await requireUser();
  const db = getDb();
  const [connections, tokens, spaces] = await Promise.all([
    listAgentConnections(db, me.id),
    listAgentTokens(db, me.id),
    listMySpaces(db, me.id),
  ]);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6">
        <header className="flex flex-col items-start gap-2">
          <Link
            href="/dashboard"
            className={cx(
              "-ml-2 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-ed-muted hover:bg-ed-hover hover:text-ed-text",
              FOCUS_RING,
              FADE,
            )}
          >
            <ChevronLeft aria-hidden size={14} />
            Projects
          </Link>
          <h1 className="text-base font-semibold">AI agents</h1>
          <p className="text-[13px] leading-5 text-ed-muted">
            Connect Claude, ChatGPT or any AI agent that speaks MCP. You can connect as many as you like; each one acts as
            you and its changes are labeled with its name.
          </p>
          {!canChangeInAnySpace(spaces) && (
            <p className="text-[13px] leading-5 text-ed-muted">
              You&apos;re a viewer, so your agents can read projects but not change them.
            </p>
          )}
        </header>
        <AgentsView
          serverUrl={mcpResourceUrl()}
          connections={connections}
          tokens={tokens}
          nameLimit={MAX_TOKEN_NAME}
          now={new Date()}
          actions={ACTIONS}
        />
      </div>
    </main>
  );
}
