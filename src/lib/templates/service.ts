import { and, asc, count, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "@/db";
import { projects, templates } from "@/db/schema";
import { requireRole, type Actor } from "@/lib/actor";
import { getBrandFonts } from "@/lib/brand/service";
import { DEFAULT_BRAND_FONTS } from "@/lib/brand/types";
import { LIMITS } from "@/lib/limits";
import { failedOn } from "@/lib/projects/service";
import { projectName } from "@/lib/projects/schemas";
import { ServiceError } from "@/lib/service-error";
import { isStorableText } from "@/lib/text";
import { mixedSlots, slotsOf, toTemplateDoc } from "@/lib/timeline";
import { starterTemplates, STARTER_PREFIX } from "./starters";
import type { Template, TemplateSummary } from "./types";

const NAME_INDEX = "templates_space_name_idx";

const invalid = (message: string) => new ServiceError("INVALID", 400, message);
const NAME_TAKEN = "A template with that name exists";
const isNameTaken = (error: unknown) => failedOn(error, "23505", NAME_INDEX);
const isStarterId = (id: string) => id.startsWith(STARTER_PREFIX);

function checkName(name: string): string {
  const parsed = projectName.safeParse(name);
  if (!parsed.success) throw invalid(`Enter a name up to ${LIMITS.projectNameChars} characters.`);
  if (starterTemplates(DEFAULT_BRAND_FONTS).some((t) => t.name.toLowerCase() === parsed.data.toLowerCase())) {
    throw invalid("That name belongs to a starter template");
  }
  return parsed.data;
}

function checkText(label: string, value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > max) throw invalid(`${label} can be at most ${max} characters.`);
  if (!isStorableText(value)) throw invalid(`${label} contains a character that cannot be saved.`);
  return value;
}

const columns = {
  id: templates.id,
  name: templates.name,
  description: templates.description,
  instructions: templates.instructions,
  format: templates.format,
  width: templates.width,
  height: templates.height,
  doc: templates.doc,
  updatedAt: templates.updatedAt,
};

type Row = { id: string; name: string; description: string; instructions: string; format: Template["format"]; width: number; height: number; doc: Template["doc"]; updatedAt: Date };

const toTemplate = (row: Row): Template => ({
  id: row.id,
  name: row.name,
  description: row.description,
  instructions: row.instructions,
  format: row.format,
  width: row.width,
  height: row.height,
  builtIn: false,
  slots: slotsOf(row.doc),
  updatedAt: row.updatedAt.toISOString(),
  doc: row.doc,
});

const summaryOf = (t: Template): TemplateSummary => ({
  id: t.id, name: t.name, description: t.description, format: t.format, width: t.width, height: t.height,
  builtIn: t.builtIn, slots: t.slots, updatedAt: t.updatedAt,
});

// The built-in starters, then the space's own by name.
export async function listTemplates(db: DB, actor: Actor): Promise<TemplateSummary[]> {
  requireRole(actor, "viewer");
  const rows = await db.select(columns).from(templates).where(eq(templates.spaceId, actor.spaceId)).orderBy(asc(sql`lower(${templates.name})`), asc(templates.id));
  return [...starterTemplates(DEFAULT_BRAND_FONTS).map(summaryOf), ...rows.map((r) => summaryOf(toTemplate(r)))];
}

export async function getTemplate(db: DB, actor: Actor, id: string): Promise<Template | null> {
  requireRole(actor, "viewer");
  if (isStarterId(id)) {
    return starterTemplates(await getBrandFonts(db, actor)).find((t) => t.id === id) ?? null;
  }
  const [row] = await db.select(columns).from(templates).where(and(eq(templates.id, id), eq(templates.spaceId, actor.spaceId)));
  return row ? toTemplate(row) : null;
}

export async function saveTemplate(
  db: DB,
  actor: Actor,
  input: { projectId: string; name: string; description?: string; instructions?: string; replace?: boolean },
): Promise<{ id: string; replaced: boolean }> {
  requireRole(actor, "editor");
  const [project] = await db
    .select({ doc: projects.doc })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.spaceId, actor.spaceId), sql`${projects.deletedAt} is null`));
  if (!project) throw new ServiceError("NOT_FOUND", 404, `Project "${input.projectId}" not found`);

  const name = checkName(input.name);
  const description = checkText("The description", input.description, LIMITS.templateDescriptionChars) ?? "";
  const instructions = checkText("The instructions", input.instructions, LIMITS.templateInstructionsChars) ?? "";
  const mixed = mixedSlots(project.doc);
  if (mixed.length > 0) throw invalid(`${mixed[0]} is used for both text and footage`);
  const doc = toTemplateDoc(project.doc);
  if (slotsOf(doc).length === 0) throw invalid("Mark at least one clip as a slot first");

  const [{ total }] = await db.select({ total: count() }).from(templates).where(eq(templates.spaceId, actor.spaceId));
  const full = () => invalid(`This space has ${total} templates, the most it can keep. Delete one first.`);
  const same = and(eq(templates.spaceId, actor.spaceId), sql`lower(${templates.name}) = lower(${name})`);
  const overwrite = async () => {
    const [row] = await db
      .update(templates)
      .set({ name, doc, description, instructions, format: doc.format, width: doc.width, height: doc.height, updatedBy: actor.userId, updatedAt: sql`now()` })
      .where(same)
      .returning({ id: templates.id });
    return row;
  };

  // A replace never adds a row, so it is not held to the limit.
  if (input.replace) {
    const row = await overwrite();
    if (row) return { id: row.id, replaced: true };
  }
  if (total >= LIMITS.templatesPerSpace) throw full();
  const id = nanoid(12);
  try {
    await db.insert(templates).values({
      id, spaceId: actor.spaceId, name, description, instructions, format: doc.format, width: doc.width, height: doc.height, doc,
      createdBy: actor.userId, updatedBy: actor.userId,
    });
    return { id, replaced: false };
  } catch (error) {
    if (!isNameTaken(error)) throw error;
    if (!input.replace) throw new ServiceError("CONFLICT", 409, NAME_TAKEN);
    const row = await overwrite();
    if (row) return { id: row.id, replaced: true };
    throw new ServiceError("CONFLICT", 409, NAME_TAKEN);
  }
}

export async function updateTemplate(
  db: DB,
  actor: Actor,
  id: string,
  patch: { name?: string; description?: string; instructions?: string },
): Promise<void> {
  requireRole(actor, "editor");
  if (isStarterId(id)) throw invalid("Starter templates can't be changed");
  const set: Partial<typeof templates.$inferInsert> = { updatedBy: actor.userId, updatedAt: sql`now()` as never };
  if (patch.name !== undefined) set.name = checkName(patch.name);
  const description = checkText("The description", patch.description, LIMITS.templateDescriptionChars);
  if (description !== undefined) set.description = description;
  const instructions = checkText("The instructions", patch.instructions, LIMITS.templateInstructionsChars);
  if (instructions !== undefined) set.instructions = instructions;
  let rows: { id: string }[];
  try {
    rows = await db.update(templates).set(set).where(and(eq(templates.id, id), eq(templates.spaceId, actor.spaceId))).returning({ id: templates.id });
  } catch (error) {
    if (isNameTaken(error)) throw new ServiceError("CONFLICT", 409, NAME_TAKEN);
    throw error;
  }
  if (!rows[0]) throw new ServiceError("NOT_FOUND", 404, "Template not found");
}

export async function deleteTemplate(db: DB, actor: Actor, id: string): Promise<void> {
  requireRole(actor, "editor");
  if (isStarterId(id)) throw invalid("Starter templates can't be deleted");
  const rows = await db.delete(templates).where(and(eq(templates.id, id), eq(templates.spaceId, actor.spaceId))).returning({ id: templates.id });
  if (!rows[0]) throw new ServiceError("NOT_FOUND", 404, "Template not found");
}
