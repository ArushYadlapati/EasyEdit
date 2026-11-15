import type { DB } from "@/db";
import type { Actor } from "@/lib/actor";
import type { CurrentUser } from "@/lib/access-rules";
import type { AgentKind } from "@/lib/connector/agents";
import type { Limits } from "@/lib/limits";
import type { MySpace } from "@/lib/spaces/types";

// Everything a tool needs to act for a person's AI agent. `spaces` are all the person's spaces; a tool picks the
// actor for the space of the project (or the space named) it works on.
export type ToolContext = { db: DB; user: CurrentUser; agent: AgentKind; spaces: MySpace[]; baseUrl: string; limits: Limits; now: () => Date };
// A context already narrowed to one space: the actor is the agent acting for the person in that space.
export type SpaceToolContext = ToolContext & { actor: Actor };
export type ToolResult = { text: string; isError: boolean };

export const ok = (text: string): ToolResult => ({ text, isError: false });
export const fail = (text: string): ToolResult => ({ text, isError: true });
