import { meetsRole } from "@/lib/access-rules";
import { sourceFrames } from "@/lib/media/rules";
import { loadAssetFacts } from "@/lib/media/service";
import { getProject } from "@/lib/projects/service";
import { fillSlots, type FillAsset, type SlotFill } from "@/lib/templates/fill";
import { getTemplate, listTemplates } from "@/lib/templates/service";
import type { Template, TemplateSummary } from "@/lib/templates/types";
import { escapeQuoted, formatLabel, slotsOf, describe, type SlotSummary } from "@/lib/timeline";
import { actorInSpace, projectContext } from "../actors";
import { editedText, priorEdit, runEdit } from "../edit";
import { conflictResult, notFoundText, roleMessage } from "../errors";
import { oneLine } from "../one-line";
import { quotedSpace } from "../space-label";
import { fail, ok, type ToolContext, type ToolResult } from "../types";
import { PERSONAL_ALIAS, type MySpace } from "@/lib/spaces/types";
import { noSuchSpace } from "./create-project";
import { KIND_WORDS, slotLine } from "../slot-text";


const frame = (t: { format: Parameters<typeof formatLabel>[0]["format"]; width: number; height: number }) => formatLabel(t);

function templateLines(t: TemplateSummary): string[] {
  const star = t.builtIn ? " (starter)" : "";
  const lines = [`${t.id} · ${oneLine(t.name)}${star} · ${frame(t)} · slots: ${slotLine(t.slots) || "none"}`];
  if (t.description.trim()) lines.push(`  ${oneLine(t.description)}`);
  return lines;
}

// The spaces a tool call is about: the one named, or all of the person's.
function spacesFor(ctx: ToolContext, slug: string | undefined): MySpace[] | { error: string } {
  if (slug === undefined) return ctx.spaces;
  const space = slug === PERSONAL_ALIAS ? ctx.spaces.find((s) => s.kind === "personal") : ctx.spaces.find((s) => s.slug === slug);
  if (!space) return { error: noSuchSpace(ctx, slug) };
  return [space];
}

export async function listTemplatesTool(ctx: ToolContext, input: { space?: string }): Promise<ToolResult> {
  const spaces = spacesFor(ctx, input.space);
  if ("error" in spaces) return fail(spaces.error);
  const lines: string[] = [];
  for (const space of spaces) {
    const actor = actorInSpace(ctx, space.id)!;
    const list = await listTemplates(ctx.db, actor);
    lines.push(`Space ${quotedSpace(space.name)} (${space.kind === "personal" ? PERSONAL_ALIAS : space.slug}):`);
    for (const t of list) lines.push(...templateLines(t));
  }
  lines.push("Start a project from one with create_project (template). Read one with get_template.");
  return ok(lines.join("\n"));
}

function fullSlotLines(slots: SlotSummary[]): string[] {
  return slots.map((s) => `  ${s.name} (${KIND_WORDS[s.kind]})${s.hint ? ` "${escapeQuoted(oneLine(s.hint))}"` : ""}`);
}

export async function getTemplateTool(ctx: ToolContext, input: { template: string; space?: string }): Promise<ToolResult> {
  const spaces = spacesFor(ctx, input.space);
  if ("error" in spaces) return fail(spaces.error);
  let found: Template | null = null;
  if (input.template.startsWith("starter-")) {
    // Starters exist everywhere; the space only decides the brand fonts.
    const space = input.space !== undefined ? spaces[0] : ctx.spaces.length === 1 ? ctx.spaces[0] : (ctx.spaces.find((s) => s.kind === "team") ?? ctx.spaces[0]);
    found = await getTemplate(ctx.db, actorInSpace(ctx, space.id)!, input.template);
  } else {
    for (const space of spaces) {
      found = await getTemplate(ctx.db, actorInSpace(ctx, space.id)!, input.template);
      if (found) break;
    }
  }
  if (!found) return fail(`No template ${input.template}.`);
  const lines = [`Template ${input.template}: "${escapeQuoted(oneLine(found.name))}", ${frame(found)}.`];
  if (found.description.trim()) lines.push(oneLine(found.description));
  if (found.instructions.trim()) lines.push(`Notes for you: ${found.instructions.trim()}`);
  lines.push("Slots:", ...fullSlotLines(slotsOf(found.doc)), "", describe(found.doc));
  return ok(lines.join("\n"));
}

type FillInput = { project_id: string; expected_version: number; slots: { slot: string; text?: string; asset_id?: string; in_seconds?: number }[] };

export async function fillTemplateTool(base: ToolContext, input: FillInput): Promise<ToolResult> {
  const ctx = await projectContext(base, input.project_id);
  if (!ctx) return fail(notFoundText(input.project_id));
  if (!meetsRole(ctx.actor.role, "editor")) return fail(roleMessage(ctx.actor.role));

  const edit = { projectId: input.project_id, expectedVersion: input.expected_version, key: { tool: "fill_template", slots: input.slots } };
  const prior = await priorEdit(ctx, edit);
  if (prior) return answer(ctx, input, prior);

  const project = await getProject(ctx.db, ctx.actor, input.project_id);
  if (!project) return fail(notFoundText(input.project_id));
  if (project.version !== input.expected_version) return conflictResult(ctx, input.project_id, input.expected_version);

  const { doc } = project;
  const facts = await loadAssetFacts(ctx.db, ctx.actor.spaceId, input.slots.flatMap((s) => (s.asset_id === undefined ? [] : [s.asset_id])));
  const assets = new Map<string, FillAsset>();
  for (const fact of facts.values()) {
    if (fact.removed || !fact.ready) continue;
    const durationFrames = fact.kind === "image" || fact.durationMs === null ? null : sourceFrames(fact.durationMs, doc.fps);
    assets.set(fact.id, { id: fact.id, kind: fact.kind, durationFrames });
  }
  const fills: SlotFill[] = input.slots.map((s) => ({
    slot: s.slot,
    ...(s.text !== undefined ? { text: s.text } : {}),
    ...(s.asset_id !== undefined ? { assetId: s.asset_id } : {}),
    ...(s.in_seconds !== undefined ? { inFrames: Math.round(s.in_seconds * doc.fps) } : {}),
  }));
  const planned = fillSlots(doc, fills, assets);
  if ("error" in planned) return fail(planned.error);
  return answer(ctx, input, await runEdit(ctx, { ...edit, ops: planned.ops }));
}

function answer(ctx: ToolContext, input: FillInput, done: Awaited<ReturnType<typeof runEdit>>): ToolResult {
  if (!done.ok) return done.result;
  const names = input.slots.map((s) => s.slot);
  const lines = [editedText(ctx, `Filled the template as version ${done.applied.version}.`, done), `Filled: ${names.join(", ")}.`];
  const empty = slotsOf(done.project.doc).filter((s) => !s.filled).map((s) => s.name);
  if (empty.length > 0) lines.push(`Still empty: ${empty.join(", ")}.`);
  return ok(lines.join("\n"));
}
