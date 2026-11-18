import { meetsRole } from "@/lib/access-rules";
import { loadTranscripts } from "@/lib/captions/transcripts";
import { addTrackOps } from "@/lib/editor/commands";
import { getProject } from "@/lib/projects/service";
import { captionTrack, formatFields, transcriptOf, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { projectContext } from "../actors";
import { editedText, runEdit } from "../edit";
import { assetInOtherSpace, assetNotUsable, notFoundText, opNotAvailable } from "../errors";
import { checkAllowedOps, checkAssetOps } from "../op-rules";
import { fail, ok, type ToolContext, type ToolResult } from "../types";

// A custom size equal to a named size is that named size, as everywhere else.
function namedSize(op: unknown): unknown {
  if (typeof op !== "object" || op === null) return op;
  const { width, height, ...rest } = op as Record<string, unknown>;
  if (rest.op !== "set_format" || rest.format !== "custom" || typeof width !== "number" || typeof height !== "number") return op;
  const fields = formatFields({ width, height });
  return fields.format === "custom" ? op : { ...rest, ...fields };
}

// The files whose clips these ops turn captions on for: an update_clip that sets captions true (on a clip of the
// project, or one added earlier in the same batch) and an added video or audio clip that starts with captions on.
function captionFilesTurnedOn(doc: TimelineDoc, ops: unknown[]): string[] {
  const assetOf = new Map<string, string>();
  for (const track of doc.tracks) for (const clip of track.clips) if (clip.type === "video" || clip.type === "audio") assetOf.set(clip.id, clip.assetId);
  const files = new Set<string>();
  for (const raw of ops) {
    if (typeof raw !== "object" || raw === null) continue;
    const op = raw as { op?: unknown; clip?: Record<string, unknown>; clipId?: unknown; patch?: Record<string, unknown> };
    if (op.op === "add_clip" && typeof op.clip === "object" && op.clip !== null) {
      const { id, type, assetId, captions } = op.clip;
      const media = (type === "video" || type === "audio") && typeof assetId === "string";
      if (media && typeof id === "string") assetOf.set(id, assetId);
      if (media && captions === true) files.add(assetId);
    } else if (op.op === "update_clip" && typeof op.patch === "object" && op.patch !== null) {
      const { captions, assetId } = op.patch;
      if (typeof op.clipId === "string" && typeof assetId === "string" && assetOf.has(op.clipId)) assetOf.set(op.clipId, assetId);
      const file = typeof op.clipId === "string" ? assetOf.get(op.clipId) : undefined;
      if (captions === true && file) files.add(file);
    }
  }
  return [...files];
}

const hasCaptionOps = (ops: unknown[]) =>
  ops.some((raw) => {
    const op = raw as { op?: unknown; clip?: { captions?: unknown }; patch?: { captions?: unknown } } | null;
    return op?.op === "add_clip" ? op.clip?.captions === true : op?.op === "update_clip" ? op.patch?.captions === true : false;
  });

function noSavedCaptions(assetIds: string[]): string {
  return `No saved captions for ${assetIds.join(", ")}. Ask a person to open the project and press Auto captions in the Captions tab; then try again.`;
}

export async function editTimelineTool(
  ctx: ToolContext,
  input: { project_id: string; expected_version: number; ops: unknown[] },
): Promise<ToolResult> {
  const notAllowed = checkAllowedOps(input.ops);
  if (notAllowed) return opNotAvailable(notAllowed);
  // The project's space first: its media is the only media its clips may name.
  const pc = await projectContext(ctx, input.project_id);
  if (!pc) return fail(notFoundText(input.project_id));
  // Before the project is read: an asset id that is wrong says how to find the right one.
  const badAsset = await checkAssetOps(pc.db, pc.actor.spaceId, input.ops);
  if (badAsset) {
    const elsewhere = badAsset.trouble === "missing" ? await assetInOtherSpace(ctx, badAsset.assetId!, pc.actor.spaceId) : null;
    return assetNotUsable(elsewhere ? { ...badAsset, reason: elsewhere } : badAsset);
  }

  // Turning captions on needs the file's words in the document, and the Captions track to show them on. When the
  // project has moved since expected_version nothing is added: the edit below gives its normal conflict answer.
  const before: OpInput[] = [];
  if (hasCaptionOps(input.ops) && meetsRole(pc.actor.role, "editor")) {
    const project = await getProject(pc.db, pc.actor, input.project_id);
    if (project && project.version === input.expected_version) {
      const files = captionFilesTurnedOn(project.doc, input.ops);
      const missing = files.filter((assetId) => transcriptOf(project.doc, assetId) === undefined);
      const saved = await loadTranscripts(pc.db, pc.actor.spaceId, missing);
      const without = missing.filter((assetId) => !saved.has(assetId));
      if (without.length > 0) return fail(noSavedCaptions(without));
      const hasTrackOp = input.ops.some((op) => (op as { op?: unknown; track?: { kind?: unknown } } | null)?.op === "add_track" && (op as { track: { kind?: unknown } }).track?.kind === "caption");
      if (files.length > 0 && !captionTrack(project.doc) && !hasTrackOp) before.push(...addTrackOps(project.doc, "caption"));
      for (const assetId of missing) before.push({ op: "set_transcript", assetId, words: saved.get(assetId)! });
    }
  }

  // The engine checks each op's shape; the service refuses the whole batch if one is wrong.
  const done = await runEdit(pc, {
    projectId: input.project_id,
    expectedVersion: input.expected_version,
    ops: [...before, ...(input.ops.map(namedSize) as OpInput[])],
    key: input.ops,
  });
  if (!done.ok) return done.result;
  const n = done.applied.ops.length;
  return ok(editedText(pc, `Applied ${n} ${n === 1 ? "op" : "ops"} as version ${done.applied.version}.`, done));
}
