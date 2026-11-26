import type { DB } from "@/db";
import type { Actor } from "@/lib/actor";
import type { CurrentUser } from "@/lib/access-rules";
import type { AgentKind } from "@/lib/connector/agents";
import type { Limits } from "@/lib/limits";
import type { MySpace } from "@/lib/spaces/types";

// Everything a tool needs to act for a person's AI agent. `spaces` are all the person's spaces; a tool picks the
// actor for the space of the project (or the space named) it works on. `fetch` is what a video site is asked with when
// save_style adds a link; left out, the real fetch. Tests pass a fake one so no real site is called.
export type ToolContext = {
  db: DB;
  user: CurrentUser;
  agent: AgentKind;
  spaces: MySpace[];
  baseUrl: string;
  limits: Limits;
  now: () => Date;
  fetch?: typeof fetch;
};
// A context already narrowed to one space: the actor is the agent acting for the person in that space.
export type SpaceToolContext = ToolContext & { actor: Actor };
// A picture a tool hands back after its text: the bytes as base64, and their type, such as image/jpeg.
export type ToolImage = { data: string; mimeType: string };
// What a tool answers: its text, whether it was refused, and any pictures, which come after the text. Some clients
// show no pictures (ChatGPT drops them), so the text must say everything the agent needs without them.
export type ToolResult = { text: string; isError: boolean; images?: ToolImage[] };

export const ok = (text: string): ToolResult => ({ text, isError: false });
export const fail = (text: string): ToolResult => ({ text, isError: true });
// A successful answer with pictures after its text. With no pictures it is the same as ok.
export const okWithImages = (text: string, images: ToolImage[]): ToolResult => (images.length > 0 ? { text, isError: false, images } : ok(text));
