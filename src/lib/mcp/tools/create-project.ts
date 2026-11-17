import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { projects } from "@/db/schema";
import { meetsRole } from "@/lib/access-rules";
import { projectFrame } from "@/lib/projects/schemas";
import { getTemplate } from "@/lib/templates/service";
import { createProject, getProject, storedHeight, storedWidth } from "@/lib/projects/service";
import { ServiceError } from "@/lib/service-error";
import { isStorableText } from "@/lib/text";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { PERSONAL_ALIAS, type MySpace } from "@/lib/spaces/types";
import { escapeQuoted, slotsOf } from "@/lib/timeline";
import { actorInSpace } from "../actors";
import { checkProjectBudget } from "../budget";
import { roleMessage } from "../errors";
import { oneLine } from "../one-line";
import { projectPage } from "../project-text";
import { quotedSpace } from "../space-label";
import { slotLine } from "../slot-text";
import { fail, ok, type SpaceToolContext, type ToolContext, type ToolResult } from "../types";

// A repeat of the same create within this window is taken as a retry, and answers with the project it already made.
const TWIN_WINDOW = sql`interval '60 seconds'`;

type CreateInput = { name: string; format?: string; template?: string; width?: number; height?: number; space?: string };

type Chosen = { space: MySpace } | { error: string };

const canEditIn = (space: MySpace) => meetsRole(space.role, "editor");

// The spaces a project can be made in: where the person is an editor or admin, Personal only while it is offered.
const creatableSpaces = (ctx: ToolContext) => ctx.spaces.filter((s) => canEditIn(s) && (s.kind === "team" || personalSpacesOpen()));

const spaceList = (spaces: MySpace[]) => spaces.map((s) => `${quotedSpace(s.name)} (space: ${s.kind === "personal" ? PERSONAL_ALIAS : s.slug})`).join(", ");

// The answer when no space is named and the person could use more than one: ask them.
export function whichSpace(ctx: ToolContext): string {
  return `Ask the person which space this project should go in, then call create_project again with space set. Their spaces: ${spaceList(creatableSpaces(ctx))}.`;
}

const teamList = (ctx: ToolContext) =>
  ctx.spaces.filter((s) => s.kind === "team").map((s) => `${quotedSpace(s.name)} (space: ${s.slug})`).join(", ");

// Personal spaces are not offered yet: a project goes in a team.
export function personalSoon(ctx: ToolContext): string {
  const teams = teamList(ctx);
  return teams
    ? `Personal spaces are coming soon, so a project goes in a team. Your teams: ${teams}.`
    : "Personal spaces are coming soon, and you are not in a team yet. Create a team in EasyEdit first.";
}

// The space a person names: a slug, or "personal" for their own. Left out, it is the one space they can create in; with
// more than one, they are asked (whichSpace). With none, the answer is the role message (or personalSoon while personal
// spaces are closed). While personal spaces are not offered, the personal space, by its alias or its own slug, is refused.
async function chosenSpace(ctx: ToolContext, slug: string | undefined): Promise<Chosen> {
  const open = personalSpacesOpen();
  if (slug === undefined) {
    const creatable = creatableSpaces(ctx);
    if (creatable.length === 1) return { space: creatable[0] };
    if (creatable.length > 1) return { error: whichSpace(ctx) };
    // None to create in: the role check answers for the space they do have.
    const fallback = open ? ctx.spaces.find((s) => s.kind === "personal") : ctx.spaces.find((s) => s.kind === "team");
    return fallback ? { space: fallback } : { error: open ? noSuchSpace(ctx, PERSONAL_ALIAS) : personalSoon(ctx) };
  }
  const space = slug === PERSONAL_ALIAS ? ctx.spaces.find((s) => s.kind === "personal") : ctx.spaces.find((s) => s.slug === slug);
  if (!space) return { error: noSuchSpace(ctx, slug) };
  if (space.kind === "personal" && !open) return { error: personalSoon(ctx) };
  return { space };
}

// The person's spaces as create_project takes them; the personal space is left out while it is not offered.
export function noSuchSpace(ctx: ToolContext, slug: string): string {
  const offered = personalSpacesOpen() ? ctx.spaces : ctx.spaces.filter((s) => s.kind === "team");
  if (offered.length === 0) return personalSoon(ctx); // in no team, and personal spaces are not offered
  return `No space "${escapeQuoted(oneLine(slug))}". Your spaces: ${spaceList(offered)}.`;
}

// Claude's projects land in no folder: no folder is passed, and no tool mentions folders.
export async function createProjectTool(base: ToolContext, input: CreateInput): Promise<ToolResult> {
  if (input.format === undefined && input.template === undefined) return fail("Give a format, or a template from list_templates.");
  const chosen = await chosenSpace(base, input.space);
  if ("error" in chosen) return fail(chosen.error);
  const { space } = chosen;
  const actor = actorInSpace(base, space.id);
  if (!actor) return fail(noSuchSpace(base, input.space ?? PERSONAL_ALIAS));
  const ctx: SpaceToolContext = { ...base, actor };
  if (!meetsRole(ctx.actor.role, "editor")) return fail(roleMessage(ctx.actor.role));

  // The format and size are the template's, when there is one. A template that is not there is left to createProject to refuse.
  let templateFormat: string | undefined;
  let frame: { format: string; width: number; height: number } | { error: string } | null = null;
  if (input.template !== undefined) {
    const template = await getTemplate(ctx.db, ctx.actor, input.template);
    templateFormat = template?.format;
    if (template) frame = { format: template.format, width: template.width, height: template.height };
  } else if (input.format !== undefined) {
    frame = projectFrame({ format: input.format, width: input.width, height: input.height });
  }
  const twinId = frame && !("error" in frame) ? await findTwin(ctx, input.name, frame) : null;
  const twin = twinId ? await getProject(ctx.db, ctx.actor, twinId) : null;
  if (twin) return answer(ctx, twin, `This project was created a moment ago, so it is used again: "${escapeQuoted(twin.name)}" (id ${twin.id}).`);

  const budget = await checkProjectBudget(ctx.db, ctx.actor.userId, ctx.limits);
  if (!budget.ok) return fail(budget.message);

  let id: string;
  try {
    ({ id } = await createProject(ctx.db, ctx.actor, { name: input.name, format: templateFormat ?? input.format ?? "", templateId: input.template, width: input.width, height: input.height }));
  } catch (error) {
    if (error instanceof ServiceError) return fail(error.message);
    throw error;
  }
  const project = await getProject(ctx.db, ctx.actor, id);
  if (!project) throw new Error("A project just created could not be read");
  const slots = input.template === undefined ? [] : slotsOf(project.doc);
  const made = answer(ctx, project, `Created project "${escapeQuoted(project.name)}" (id ${project.id}) in space ${quotedSpace(space.name)}, version 0.`);
  if (slots.length === 0) return made;
  return ok(`${made.text}\nSlots to fill with fill_template: ${slotLine(slots)}.`);
}

// A live project this actor created in the last minute with the same trimmed name, format and size.
// A name the database cannot store, or a format and size the service refuses, has no twin; skipping the lookup lets
// the service refuse it with its sentence.
async function findTwin(ctx: SpaceToolContext, rawName: string, frame: { format: string; width: number; height: number }): Promise<string | null> {
  const name = rawName.trim();
  if (!isStorableText(name)) return null;
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
