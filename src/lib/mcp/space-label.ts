import { escapeQuoted } from "@/lib/timeline";
import { oneLine } from "./one-line";
import type { ToolContext } from "./types";

// A space's name is people's text: quoted and escaped like every other name a tool prints.
export const quotedSpace = (name: string) => `"${escapeQuoted(oneLine(name))}"`;

export const spaceLabel = (name: string) => `Space: ${quotedSpace(name)}`;

// The person's spaces, one per entry, as "Name" (role). For lists a person reads.
export const spacesWithRoles = (ctx: ToolContext) => ctx.spaces.map((s) => `${quotedSpace(s.name)} (${s.kind === "personal" ? "personal" : s.slug}, ${s.role})`).join(", ");

// Where each of the person's spaces is by id, for results that merge rows from every space.
export const spaceNames = (ctx: ToolContext) => new Map(ctx.spaces.map((s) => [s.id, s.name]));
