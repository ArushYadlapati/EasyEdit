import { meetsRole } from "@/lib/access-rules";
import { summarizeOps } from "@/lib/editor/activity";
import { getOpsSince, getProject } from "@/lib/projects/service";
import type { OpInput } from "@/lib/timeline";
import { projectContext } from "../actors";
import { editedText, runEdit } from "../edit";
import { noSuchChange, notFoundText, noUndoData, roleMessage, undoBeforeMove, undoFailure } from "../errors";
import { fail, ok, type ToolContext, type ToolResult } from "../types";

// Applies the inverse stored with an earlier change, as a new change, like the editor's Activity list does.
// The inverse's guards refuse it when that part of the project was changed afterwards.
export async function undoChangeTool(
  ctx: ToolContext,
  input: { project_id: string; expected_version: number; version: number },
): Promise<ToolResult> {
  const { project_id: projectId, expected_version: expectedVersion, version } = input;
  const pc = await projectContext(ctx, projectId);
  if (!pc) return fail(notFoundText(projectId));
  if (!meetsRole(pc.actor.role, "editor")) return fail(roleMessage(pc.actor.role));

  const project = await getProject(pc.db, pc.actor, projectId);
  if (!project) return fail(notFoundText(projectId));
  const page = await getOpsSince(pc.db, pc.actor, projectId, version - 1, 1);
  if (!page) return fail(notFoundText(projectId));
  const entry = page.entries[0];
  if (!entry || entry.version !== version) return fail(noSuchChange(version));
  // Its undo data may name media of the space the project left.
  if (project.movedAtVersion !== null && version < project.movedAtVersion) return fail(undoBeforeMove(version));
  if (!entry.inverse || entry.inverse.length === 0) return fail(noUndoData(version));

  // Not checked against the ops Claude may send: stored undo data may restore a whole track.
  const done = await runEdit(pc, { projectId, expectedVersion, ops: entry.inverse as OpInput[], key: { tool: "undo_change", version } });
  if (!done.ok) return undoFailure(version, done.result);
  return ok(editedText(pc, `Undid version ${version} (${summarizeOps(entry.ops)}) as version ${done.applied.version}.`, done));
}
