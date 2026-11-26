import { getProject } from "@/lib/projects/service";
import { slugFor } from "@/lib/spaces/paths";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { hasStyle } from "@/lib/style/agent";
import { escapeQuoted } from "@/lib/timeline";
import { projectContext } from "../actors";
import { CURSOR_NEEDS_VERSION, notFoundText, projectChangedWhileReading } from "../errors";
import { projectPage } from "../project-text";
import { fail, ok, type SpaceToolContext, type ToolContext, type ToolResult } from "../types";

// The line under a first page's header when the project's space has a saved style, saying how to read it. None for a
// personal space while personal spaces are not offered, since get_editing_guide would refuse it.
async function styleHint(ctx: SpaceToolContext): Promise<string[]> {
  const space = ctx.spaces.find((s) => s.id === ctx.actor.spaceId);
  if (!space || (space.kind === "personal" && !personalSpacesOpen())) return [];
  if (!(await hasStyle(ctx.db, space.id))) return [];
  return [`Style: this space has a saved style. Read it with get_editing_guide and space "${escapeQuoted(slugFor(space))}".`];
}

// A page after the first is read only at the version the earlier pages came from: lines shift when the project changes,
// so a page from another version could skip clips or show them twice.
export async function getProjectTool(
  ctx: ToolContext,
  input: { project_id: string; cursor?: number; version?: number },
): Promise<ToolResult> {
  const pc = await projectContext(ctx, input.project_id);
  const project = pc && (await getProject(pc.db, pc.actor, input.project_id));
  if (!pc || !project) return fail(notFoundText(input.project_id));
  const cursor = input.cursor ?? 0;
  if (cursor > 0) {
    if (input.version === undefined) return fail(CURSOR_NEEDS_VERSION);
    if (input.version !== project.version) return fail(projectChangedWhileReading(project.version));
  }
  const notes = cursor === 0 ? await styleHint(pc) : [];
  return ok(projectPage(project, { cursor, maxChars: ctx.limits.connectorReadChars, notes }).text);
}
