import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { projects } from "@/db/schema";
import { meetsRole } from "@/lib/access-rules";
import { projectFrame } from "@/lib/projects/schemas";
import { createProject, getProject, storedHeight, storedWidth } from "@/lib/projects/service";
import { ServiceError } from "@/lib/service-error";
import { isStorableText } from "@/lib/text";
import { PERSONAL_ALIAS } from "@/lib/spaces/types";
import { escapeQuoted } from "@/lib/timeline";
import { actorInSpace } from "../actors";
import { checkProjectBudget } from "../budget";
import { roleMessage } from "../errors";
import { oneLine } from "../one-line";
import { projectPage } from "../project-text";
import { quotedSpace } from "../space-label";
import { fail, ok, type SpaceToolContext, type ToolContext, type ToolResult } from "../types";

// A repeat of the same create within this window is taken as a retry, and answers with the project it already made.
const TWIN_WINDOW = sql`interval '60 seconds'`;

type CreateInput = { name: string; format: string; width?: number; height?: number; space?: string };

// The space a person names: a slug, or "personal" for their own. Left out, it is their personal space.
function chosenSpace(ctx: ToolContext, slug: string | undefined) {
  if (slug === undefined || slug === PERSONAL_ALIAS) return ctx.spaces.find((s) => s.kind === "personal");
  return ctx.spaces.find((s) => s.slug === slug);
}

export function noSuchSpace(ctx: ToolContext, slug: string): string {
  return `No space "${escapeQuoted(oneLine(slug))}". Your spaces: ${ctx.spaces.map((s) => quotedSpace(s.name)).join(", ")}.`;
}

// Claude's projects land in no folder: no folder is passed, and no tool mentions folders.
export async function createProjectTool(base: ToolContext, input: CreateInput): Promise<ToolResult> {
  const space = chosenSpace(base, input.space);
  const actor = space && actorInSpace(base, space.id);
  if (!actor) return fail(noSuchSpace(base, input.space ?? PERSONAL_ALIAS));
  const ctx: SpaceToolContext = { ...base, actor };
  if (!meetsRole(ctx.actor.role, "editor")) return fail(roleMessage(ctx.actor.role));

  const twinId = await findTwin(ctx, input);
  const twin = twinId ? await getProject(ctx.db, ctx.actor, twinId) : null;
  if (twin) return answer(ctx, twin, `This project was created a moment ago, so it is used again: "${escapeQuoted(twin.name)}" (id ${twin.id}).`);

  const budget = await checkProjectBudget(ctx.db, ctx.actor.userId, ctx.limits);
  if (!budget.ok) return fail(budget.message);

  let id: string;
  try {
    ({ id } = await createProject(ctx.db, ctx.actor, { name: input.name, format: input.format, width: input.width, height: input.height }));
  } catch (error) {
    if (error instanceof ServiceError) return fail(error.message);
    throw error;
  }
  const project = await getProject(ctx.db, ctx.actor, id);
  if (!project) throw new Error("A project just created could not be read");
  return answer(ctx, project, `Created project "${escapeQuoted(project.name)}" (id ${project.id}), version 0.`);
}

// A live project this actor created in the last minute with the same trimmed name, format and size.
// A name the database cannot store, or a format and size the service refuses, has no twin; skipping the lookup lets
// the service refuse it with its sentence.
async function findTwin(ctx: SpaceToolContext, input: CreateInput): Promise<string | null> {
  const name = input.name.trim();
  if (!isStorableText(name)) return null;
  const frame = projectFrame(input);
  if ("error" in frame) return null;
  const rows = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.spaceId, ctx.actor.spaceId),
        eq(projects.createdBy, ctx.actor.userId),
        eq(projects.name, name),
        sql`${projects.format} = ${frame.format}`,
        sql`${storedWidth()} = ${frame.width}`,
        sql`${storedHeight()} = ${frame.height}`,
        isNull(projects.deletedAt),
        sql`${projects.createdAt} > now() - ${TWIN_WINDOW}`,
      ),
    )
    .orderBy(desc(projects.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

function answer(ctx: ToolContext, project: Parameters<typeof projectPage>[0], firstLine: string): ToolResult {
  return ok(
    [firstLine, `Open it in the editor: ${ctx.baseUrl}/editor/${project.id}`, projectPage(project, { maxChars: ctx.limits.connectorEchoChars }).text].join(
      "\n",
    ),
  );
}
