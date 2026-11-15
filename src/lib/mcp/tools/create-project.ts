import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { projects } from "@/db/schema";
import { meetsRole } from "@/lib/access-rules";
import { projectFrame } from "@/lib/projects/schemas";
import { createProject, getProject, storedHeight, storedWidth } from "@/lib/projects/service";
import { ServiceError } from "@/lib/service-error";
import { isStorableText } from "@/lib/text";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { lastSpace } from "@/lib/spaces/service";
import { PERSONAL_ALIAS, type MySpace } from "@/lib/spaces/types";
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

type Chosen = { space: MySpace } | { error: string };

const canEditIn = (space: MySpace) => meetsRole(space.role, "editor");

// The team a project goes in when none is named and personal spaces are not offered: the one the person opened last
// in EasyEdit when they can edit there, else their first by name where they can, else any team of theirs (whose role
// answer says why not).
async function defaultTeam(ctx: ToolContext): Promise<MySpace | undefined> {
  const teams = ctx.spaces.filter((s) => s.kind === "team");
  if (teams.length === 0) return undefined;
  const last = await lastSpace(ctx.db, ctx.user.id);
  const lastTeam = teams.find((s) => s.id === last.id);
  return lastTeam && canEditIn(lastTeam) ? lastTeam : (teams.find(canEditIn) ?? lastTeam ?? teams[0]);
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

// The space a person names: a slug, or "personal" for their own. Left out, it is their personal space. While personal
// spaces are not offered (personalSpacesOpen), left out is a team of theirs (defaultTeam), and the personal space,
// by its alias or its own slug, is refused.
async function chosenSpace(ctx: ToolContext, slug: string | undefined): Promise<Chosen> {
  const open = personalSpacesOpen();
  if (slug === undefined && !open) {
    const team = await defaultTeam(ctx);
    return team ? { space: team } : { error: personalSoon(ctx) };
  }
  const space = slug === undefined || slug === PERSONAL_ALIAS ? ctx.spaces.find((s) => s.kind === "personal") : ctx.spaces.find((s) => s.slug === slug);
  if (!space) return { error: noSuchSpace(ctx, slug ?? PERSONAL_ALIAS) };
  if (space.kind === "personal" && !open) return { error: personalSoon(ctx) };
  return { space };
}

// The person's spaces as create_project takes them; the personal space is left out while it is not offered.
export function noSuchSpace(ctx: ToolContext, slug: string): string {
  const offered = personalSpacesOpen() ? ctx.spaces : ctx.spaces.filter((s) => s.kind === "team");
  if (offered.length === 0) return personalSoon(ctx); // in no team, and personal spaces are not offered
  return `No space "${escapeQuoted(oneLine(slug))}". Your spaces: ${offered.map((s) => `${quotedSpace(s.name)} (space: ${s.kind === "personal" ? PERSONAL_ALIAS : s.slug})`).join(", ")}.`;
}

// Claude's projects land in no folder: no folder is passed, and no tool mentions folders.
export async function createProjectTool(base: ToolContext, input: CreateInput): Promise<ToolResult> {
  const chosen = await chosenSpace(base, input.space);
  if ("error" in chosen) return fail(chosen.error);
  const { space } = chosen;
  const actor = actorInSpace(base, space.id);
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
  return answer(ctx, project, `Created project "${escapeQuoted(project.name)}" (id ${project.id}) in space ${quotedSpace(space.name)}, version 0.`);
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
