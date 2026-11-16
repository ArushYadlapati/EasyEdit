import { actorUserId, displayActor } from "@/lib/projects/display-actor";
import { listProjects, type ProjectSummary } from "@/lib/projects/service";
import { getUserNames } from "@/lib/projects/user-names";
import { timeAgo } from "@/lib/time-ago";
import { escapeQuoted, formatLabel } from "@/lib/timeline";
import { actorInSpace } from "../actors";
import { oneLine } from "../one-line";
import { spaceLabel, spacesWithRoles } from "../space-label";
import { ok, type ToolContext, type ToolResult } from "../types";

export async function listProjectsTool(ctx: ToolContext, input: { cursor?: number }): Promise<ToolResult> {
  const lines = [
    `Signed in as ${oneLine(ctx.user.name)}.`,
    `Spaces: ${spacesWithRoles(ctx)}. You can change projects in every space you belong to. Name a space in create_project's space.`,
  ];

  const projects = await projectsOfAllSpaces(ctx);
  if (projects.length === 0) {
    lines.push("No projects yet. Create one with create_project.");
    return ok(lines.join("\n"));
  }

  const start = input.cursor ?? 0;
  const page = projects.slice(start, start + ctx.limits.connectorListPage);
  const names = await getUserNames(ctx.db, page.map((p) => actorUserId(p.updatedBy)));
  const now = ctx.now();
  lines.push(projects.length === 1 ? "1 project:" : `${projects.length} projects, most recently changed first:`);
  for (const p of page) {
    lines.push(
      `${p.id}  "${escapeQuoted(p.name)}"  ${formatLabel(p)}  version ${p.version}  changed ${timeAgo(p.updatedAt, now)} by ${oneLine(displayActor(p.updatedBy, names))}  ${spaceLabel(p.space)}`,
    );
  }
  const end = start + page.length;
  if (end < projects.length) lines.push(`Showing ${start + 1}–${end} of ${projects.length}. Call list_projects with cursor ${end} for more.`);
  lines.push(`Open a project in the editor at ${ctx.baseUrl}/editor/<id>.`);
  return ok(lines.join("\n"));
}

// Every space's projects in one list, most recently changed first (the id breaks a tie so pages never shift).
async function projectsOfAllSpaces(ctx: ToolContext): Promise<(ProjectSummary & { space: string })[]> {
  const perSpace = await Promise.all(
    ctx.spaces.map(async (space) => {
      const actor = actorInSpace(ctx, space.id)!;
      return (await listProjects(ctx.db, actor)).map((p) => ({ ...p, space: space.name }));
    }),
  );
  return perSpace.flat().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? -1 : 1));
}
