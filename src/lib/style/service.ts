import { and, asc, count, desc, eq, exists, inArray, isNotNull, isNull, like, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { DB } from "@/db";
import { assets, projects, spaceStyle, styleReference } from "@/db/schema";
import { requireRole, type Actor } from "@/lib/actor";
import { LIMITS } from "@/lib/limits";
import { libraryAsset, loadAssetFacts } from "@/lib/media/service";
import { actorUserId, displayActor } from "@/lib/projects/display-actor";
import { failedOn } from "@/lib/projects/service";
import { isJpeg } from "@/lib/projects/thumbnails";
import { getUserNames } from "@/lib/projects/user-names";
import { ServiceError } from "@/lib/service-error";
import { isStorableText, withSuffix } from "@/lib/text";
import { everyClip, type TimelineDoc } from "@/lib/timeline";
import { STYLE_FIELDS } from "./fields";
import { fetchLinkFacts, linkRefusalMessage, parseVideoLink, type VideoLink } from "./links";
import { STYLE_MESSAGES } from "./messages";
import { projectFacts, type AssetKinds } from "./project-facts";
import {
  ANALYSIS_LIMITS,
  DEFAULT_STYLE,
  LinkAnalysis,
  ProjectAnalysis,
  ReferenceAnalysis,
  StyleNotes,
  StyleProfile,
  StyleProfilePatch,
  VideoAnalysis,
  applyStylePatch,
  isSetValue,
  storedProfile,
  thumbnailAddress,
  type SheetPlan,
  type Style,
  type StylePatch,
  type StyleReference,
} from "./types";

// A space's style and what it learns from, kept per space like the brand kit: any member reads it, editors and
// admins change it. Videos are measured later in a browser (they wait as pending until then), links are read from
// their site's public facts, and past projects are counted when they are added.

const invalid = (message: string) => new ServiceError("INVALID", 400, message);
const referenceGone = () => new ServiceError("NOT_FOUND", 404, STYLE_MESSAGES.referenceGone);
const alreadyAdded = () => invalid(STYLE_MESSAGES.alreadyAdded);

// How long facts read from the space's connected YouTube channel are kept before they are cut back to the video's
// address: YouTube's rules say data from it must be refreshed or dropped within 30 days.
export const CHANNEL_FACTS_DAYS = 30;
const CHANNEL_FACTS_MS = CHANNEL_FACTS_DAYS * 24 * 60 * 60 * 1000;

// The most frame strips an agent is handed at once, newest first.
export const AGENT_SHEETS = 6;

const UNIQUE_INDEXES = ["style_reference_space_asset_unique", "style_reference_space_project_unique", "style_reference_space_url_unique"];
const isDuplicate = (error: unknown) => UNIQUE_INDEXES.some((name) => failedOn(error, "23505", name));

// --- The style ---

// The style as it is kept, with who changed it last named as the Style page names them: a person by their name, an
// agent as "Claude (for Ada)".
async function readStyle(db: DB, spaceId: string): Promise<Style> {
  const [row] = await db.select().from(spaceStyle).where(eq(spaceStyle.spaceId, spaceId));
  if (!row) return { ...DEFAULT_STYLE, profile: {} };
  const by = row.updatedBy;
  const names = by === null ? new Map<string, string>() : await getUserNames(db, [actorUserId(by)]);
  return {
    profile: storedProfile(row.profile),
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: by,
    ...(by !== null && { updatedByName: displayActor(by, names) }),
  };
}

// Any member's view of their space's style; an empty one when nobody has filled it in.
export async function getStyle(db: DB, actor: Actor): Promise<Style> {
  requireRole(actor, "viewer");
  return readStyle(db, actor.spaceId);
}

// "a", "a or b", "a, b or c".
function orList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

// What each kind of value is called in a refusal.
const KIND_WORDS: Record<string, string> = { string: "text", number: "a number", boolean: "true or false", array: "a list", object: "a set of fields" };

// What one problem with a value says, in plain words. The schema's own words ("at most 600 characters", "a number
// from 1 to 3600") are kept; zod's built-in ones, which read like code, are put another way.
function issueWords(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_value":
      return `use ${orList(issue.values.map((value) => JSON.stringify(value)))}`;
    case "invalid_type":
      return `should be ${KIND_WORDS[issue.expected] ?? issue.expected}`;
    case "unrecognized_keys":
      return `has no ${orList(issue.keys.map((key) => JSON.stringify(key)))}`;
    case "too_big":
      if (!issue.message.startsWith("Too big")) return issue.message;
      return `at most ${issue.maximum}${issue.origin === "array" ? " items" : issue.origin === "string" ? " characters" : ""}`;
    case "too_small":
      if (!issue.message.startsWith("Too small")) return issue.message;
      return `at least ${issue.minimum}${issue.origin === "array" ? " items" : issue.origin === "string" ? " characters" : ""}`;
    default:
      return issue.message;
  }
}

// "a", "a and b", "a, b and c".
function andList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

// Where a problem is, written the way a change names it: "pace", "lengthSeconds.min", "always[2]".
function keyPath(path: readonly PropertyKey[]): string {
  return path.map((part, n) => (typeof part === "number" ? `[${part}]` : `${n === 0 ? "" : "."}${String(part)}`)).join("");
}

// The keys a field that is a set of fields takes (lengthSeconds: min and max), read from the style's own rules.
// null for a field that is a single value or a list.
function subKeys(key: keyof StyleProfile): string[] | null {
  const field = StyleProfile.shape[key].unwrap();
  return field instanceof z.ZodObject ? Object.keys(field.shape) : null;
}

// What a refused profile change says: where the problem is, by its keys, then what it must be, as in
// 'lengthSeconds.min: should be a number.' or 'pace: use "calm", "steady", "quick" or "rapid".' A field that is a set
// of fields, given something else or a key it doesn't have, also says which keys it takes. A key that isn't there is
// told before anything else, since it says the most ("low" where "min" was meant). Agents send these changes; the
// Style page never sends one that is refused. Every refusal ends by saying where each field's values are explained.
function profileProblem(error: z.ZodError): string {
  const issue = error.issues.find((one) => one.code === "unrecognized_keys") ?? error.issues[0];
  const [key] = issue?.path ?? [];
  if (!issue || typeof key !== "string" || !Object.hasOwn(STYLE_FIELDS, key)) {
    const has = issue?.code === "unrecognized_keys" ? ` A style ${issueWords(issue)}.` : "";
    return `${STYLE_MESSAGES.notAStyleChange}${has} ${STYLE_MESSAGES.fieldGuide}`;
  }
  const keys = issue.path.length === 1 && (issue.code === "invalid_type" || issue.code === "unrecognized_keys") ? subKeys(key as keyof StyleProfile) : null;
  const takes = keys === null ? "" : ` ${key} takes ${andList(keys)}.`;
  return `${keyPath(issue.path)}: ${issueWords(issue)}.${takes} ${STYLE_MESSAGES.fieldGuide}`;
}

function checkedProfilePatch(patch: unknown): StyleProfilePatch {
  const parsed = StyleProfilePatch.safeParse(patch);
  if (!parsed.success) throw invalid(profileProblem(parsed.error));
  return parsed.data;
}

function checkedNotes(notes: unknown): string {
  const parsed = StyleNotes.safeParse(notes);
  if (parsed.success) return parsed.data;
  const message = parsed.error.issues[0]?.message ?? "";
  throw invalid(message === STYLE_MESSAGES.notesTooLong ? message : `notes: ${message}.`);
}

// An editor's change to their space's style. Each profile field given replaces the one kept, and null (or an empty
// text or list) takes it off; the notes, when given, replace the notes. The change is made in one statement on the
// fields it names, so two people changing different fields at once don't undo each other. A change that names
// nothing changes nothing, not even who changed the style last. Answers the style as it now is.
export async function updateStyle(db: DB, actor: Actor, patch: StylePatch): Promise<Style> {
  requireRole(actor, "editor");
  const profile = patch.profile === undefined ? undefined : checkedProfilePatch(patch.profile);
  const notes = patch.notes === undefined ? undefined : checkedNotes(patch.notes);

  const given = Object.entries(profile ?? {}).filter(([, value]) => value !== undefined);
  if (given.length === 0 && notes === undefined) return readStyle(db, actor.spaceId);
  const kept = Object.fromEntries(given.filter(([, value]) => isSetValue(value)));
  const dropped = given.filter(([, value]) => !isSetValue(value)).map(([key]) => key);
  const merged = sql.join([sql`(${spaceStyle.profile} || ${JSON.stringify(kept)}::jsonb)`, ...dropped.map((key) => sql`${key}::text`)], sql` - `);

  const changed = { updatedAt: new Date(), updatedBy: actor.userId, ...(notes !== undefined && { notes }) };
  await db
    .insert(spaceStyle)
    .values({ spaceId: actor.spaceId, profile: applyStylePatch({}, profile ?? {}), notes: notes ?? "", ...changed })
    .onConflictDoUpdate({ target: spaceStyle.spaceId, set: { ...changed, ...(given.length > 0 && { profile: merged }) } });
  return readStyle(db, actor.spaceId);
}

// --- References ---

// Every column of a reference but its strip of frames, which only the reads that hand it out select.
const REFERENCE_COLUMNS = {
  id: styleReference.id,
  kind: styleReference.kind,
  title: styleReference.title,
  assetId: styleReference.assetId,
  projectId: styleReference.projectId,
  url: styleReference.url,
  provider: styleReference.provider,
  author: styleReference.author,
  thumbnailUrl: styleReference.thumbnailUrl,
  status: styleReference.status,
  failure: styleReference.failure,
  analysis: styleReference.analysis,
  fetchedAt: styleReference.fetchedAt,
  createdAt: styleReference.createdAt,
  hasSheet: sql<boolean>`${styleReference.sheet} is not null`,
};

type ReferenceRow = Omit<typeof styleReference.$inferSelect, "spaceId" | "sheet" | "createdBy" | "updatedAt"> & { hasSheet: boolean };

// A reference of this space whose video is still in the library and whose project is still in the space (not
// deleted, not moved away). The others are kept but not shown, read or counted. Needs the reference's video and
// project joined on (left joins: a link has neither).
const isLive = (spaceId: string): SQL =>
  and(
    eq(styleReference.spaceId, spaceId),
    or(ne(styleReference.kind, "video"), isNull(assets.removedAt)),
    or(ne(styleReference.kind, "project"), and(isNull(projects.deletedAt), eq(projects.spaceId, styleReference.spaceId))),
  )!;

const newestFirst = [desc(styleReference.createdAt), asc(styleReference.id)];

async function liveRows(db: DB, spaceId: string, where?: SQL): Promise<ReferenceRow[]> {
  return db
    .select(REFERENCE_COLUMNS)
    .from(styleReference)
    .leftJoin(assets, eq(assets.id, styleReference.assetId))
    .leftJoin(projects, eq(projects.id, styleReference.projectId))
    .where(and(isLive(spaceId), where))
    .orderBy(...newestFirst);
}

async function liveRow(db: DB, actor: Actor, id: string): Promise<ReferenceRow> {
  const [row] = await liveRows(db, actor.spaceId, eq(styleReference.id, id));
  if (!row) throw referenceGone();
  return row;
}

function toReference(row: ReferenceRow): StyleReference {
  const analysis = ReferenceAnalysis.safeParse(row.analysis);
  const thumbnail = thumbnailAddress(row.thumbnailUrl);
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    ...(row.provider !== null && { provider: row.provider }),
    ...(row.author !== null && { author: row.author }),
    ...(row.url !== null && { url: row.url }),
    ...(thumbnail !== null && { thumbnailUrl: thumbnail }),
    ...(row.assetId !== null && { assetId: row.assetId }),
    ...(row.projectId !== null && { projectId: row.projectId }),
    analysis: analysis.success && analysis.data.kind === row.kind ? analysis.data : null,
    hasSheet: row.hasSheet,
    ...(row.status === "failed" && row.failure !== null && { failure: row.failure }),
    createdAt: row.createdAt.toISOString(),
  };
}

// Whether a reference holds facts from the space's connected channel that are more than CHANNEL_FACTS_DAYS old, or
// whose age can't be told.
export function hasStaleChannelFacts(reference: StyleReference, now: Date): boolean {
  if (reference.provider !== "channel") return false;
  const fetched = reference.analysis?.kind === "link" ? Date.parse(reference.analysis.fetchedAt) : Number.NaN;
  return !(now.getTime() - fetched <= CHANNEL_FACTS_MS);
}

// A reference as it may be shown: one whose channel facts are stale is cut back to the video's address, which becomes
// its title too (YouTube's title, author, picture, length, description and tags go). It keeps when its facts were
// read, so the page can offer to refresh them. Anything else is answered as it is. Pure.
export function trimStaleChannelFacts(reference: StyleReference, now: Date): StyleReference {
  if (!hasStaleChannelFacts(reference, now)) return reference;
  // A link always has its address (the table insists on it); the title only stands in for one that somehow doesn't.
  const address = reference.url ?? reference.title;
  const analysis = reference.analysis?.kind === "link" ? { kind: "link" as const, provider: "channel" as const, title: address, fetchedAt: reference.analysis.fetchedAt } : null;
  const trimmed: StyleReference = { ...reference, title: address, analysis };
  delete trimmed.author;
  delete trimmed.thumbnailUrl;
  return trimmed;
}

// Whether a row still holds more of a channel's facts than a trimmed reference shows.
function holdsMore(row: ReferenceRow, trimmed: StyleReference): boolean {
  const kept = new Set(Object.keys(trimmed.analysis ?? {}));
  return row.title !== trimmed.title || row.author !== null || row.thumbnailUrl !== null || Object.keys(row.analysis ?? {}).some((key) => !kept.has(key));
}

// Channel rows read more than CHANNEL_FACTS_DAYS before `now`, or at a time that isn't known.
const staleChannelRow = (now: Date): SQL =>
  and(eq(styleReference.provider, "channel"), or(isNull(styleReference.fetchedAt), lt(styleReference.fetchedAt, new Date(now.getTime() - CHANNEL_FACTS_MS))))!;

// A row as it may be shown, with what stale channel facts still hold beyond the video's address dropped for good.
// A row whose facts were refreshed since it was read is left alone. Answers whether the row was cut back just now.
async function trimRow(db: DB, row: ReferenceRow, now: Date): Promise<{ shown: StyleReference; cut: boolean }> {
  const reference = toReference(row);
  const shown = trimStaleChannelFacts(reference, now);
  if (shown === reference || !holdsMore(row, shown)) return { shown, cut: false };
  const updated = await db
    .update(styleReference)
    .set({ title: shown.title, author: null, thumbnailUrl: null, analysis: shown.analysis ?? {} })
    .where(and(eq(styleReference.id, row.id), staleChannelRow(now)))
    .returning({ id: styleReference.id });
  return { shown, cut: updated.length > 0 };
}

// Answers the references as they may be shown, cutting back stale channel facts as trimRow does.
async function shownReferences(db: DB, rows: ReferenceRow[], now: Date): Promise<StyleReference[]> {
  const shown: StyleReference[] = [];
  for (const row of rows) shown.push((await trimRow(db, row, now)).shown);
  return shown;
}

// The daily clean-up: in every space, the videos from a connected YouTube channel whose facts are more than
// CHANNEL_FACTS_DAYS old are cut back to their address, so YouTube's data isn't kept past then even when nobody opens
// the Style page or asks an agent to read the style. Only rows that still hold more than their address are read.
// Answers how many were cut back. No role check: it is nobody's change.
export async function trimStaleChannelReferences(db: DB, now: Date = new Date()): Promise<number> {
  const rows = await db
    .select(REFERENCE_COLUMNS)
    .from(styleReference)
    .where(
      and(
        staleChannelRow(now),
        or(
          isNotNull(styleReference.author),
          isNotNull(styleReference.thumbnailUrl),
          sql`${styleReference.title} is distinct from ${styleReference.url}`,
          sql`(${styleReference.analysis} - 'kind' - 'provider' - 'title' - 'fetchedAt') <> '{}'::jsonb`,
        ),
      ),
    );
  let cut = 0;
  for (const row of rows) if ((await trimRow(db, row, now)).cut) cut++;
  return cut;
}

// Any member's view of what their space's style learns from, newest first.
export async function listReferences(db: DB, actor: Actor, now: Date = new Date()): Promise<StyleReference[]> {
  requireRole(actor, "viewer");
  return shownReferences(db, await liveRows(db, actor.spaceId), now);
}

// Deletes references to a video removed from the library or to a deleted project, in one space or (with none named)
// in every space. Neither ever comes back, so what was learned from them (a video's strip of frames above all)
// shouldn't stay in the database. Removing the video or deleting the project deletes them already; this catches any
// left behind. A project moved to another space may be moved back, so its reference stays, hidden. Answers how many
// were deleted.
async function dropGone(db: DB, spaceId?: string): Promise<number> {
  const dropped = await db
    .delete(styleReference)
    .where(
      and(
        spaceId === undefined ? undefined : eq(styleReference.spaceId, spaceId),
        or(
          exists(db.select({ id: assets.id }).from(assets).where(and(eq(assets.id, styleReference.assetId), isNotNull(assets.removedAt)))),
          exists(db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, styleReference.projectId), isNotNull(projects.deletedAt)))),
        ),
      ),
    )
    .returning({ id: styleReference.id });
  return dropped.length;
}

// The daily clean-up's sweep of references whose video was removed from the library or whose project was deleted,
// in every space (see dropGone). Answers how many were deleted. No role check: it is nobody's change.
export function dropGoneReferences(db: DB): Promise<number> {
  return dropGone(db);
}

// Refuses one more reference when the space's style already learns from as many as it may, once the references whose
// video or project is gone for good have been cleared out.
async function checkRoom(db: DB, actor: Actor): Promise<void> {
  await dropGone(db, actor.spaceId);
  const [{ total }] = await db
    .select({ total: count() })
    .from(styleReference)
    .leftJoin(assets, eq(assets.id, styleReference.assetId))
    .leftJoin(projects, eq(projects.id, styleReference.projectId))
    .where(isLive(actor.spaceId));
  if (total >= LIMITS.styleReferences) throw invalid(STYLE_MESSAGES.tooManyReferences);
}

// Refuses a reference the space's style already has.
async function checkNew(db: DB, actor: Actor, same: SQL): Promise<void> {
  const [found] = await db
    .select({ id: styleReference.id })
    .from(styleReference)
    .where(and(eq(styleReference.spaceId, actor.spaceId), same));
  if (found) throw alreadyAdded();
}

type NewReference = Omit<typeof styleReference.$inferInsert, "id" | "spaceId" | "createdBy">;

// Adds the reference and answers it. Another member adding the same one at the same moment is refused as a duplicate.
async function insertReference(db: DB, actor: Actor, values: NewReference): Promise<StyleReference> {
  const id = nanoid(12);
  try {
    await db.insert(styleReference).values({ id, spaceId: actor.spaceId, createdBy: actor.userId, ...values });
  } catch (error) {
    if (isDuplicate(error)) throw alreadyAdded();
    throw error;
  }
  return toReference(await liveRow(db, actor, id));
}

// A title as it is kept: on one line, at most styleShortTextChars, with "…" when it was cut.
function titleOf(text: string): string {
  const line = text.replace(/[\s\p{Cc}]+/gu, " ").trim();
  return line.length <= LIMITS.styleShortTextChars ? line : withSuffix(line, "…", LIMITS.styleShortTextChars);
}

// An editor adds one of the space's finished videos. It waits as pending until a browser has measured it
// (saveVideoAnalysis) or given up (failVideoAnalysis). A video not in the library is answered as the media routes
// answer it.
export async function addVideoReference(db: DB, actor: Actor, assetId: string): Promise<StyleReference> {
  requireRole(actor, "editor");
  const asset = await libraryAsset(db, actor, assetId);
  if (asset.kind !== "video") throw invalid(STYLE_MESSAGES.notAVideo);
  if (asset.status !== "ready") throw invalid(STYLE_MESSAGES.notReady);
  await checkNew(db, actor, eq(styleReference.assetId, assetId));
  await checkRoom(db, actor);
  return insertReference(db, actor, { kind: "video", title: titleOf(asset.name), assetId, status: "pending" });
}

// A video reference of the actor's space, for its analysis to be saved or given up.
async function videoRow(db: DB, actor: Actor, id: string): Promise<ReferenceRow> {
  const row = await liveRow(db, actor, id);
  if (row.kind !== "video") throw invalid(STYLE_MESSAGES.badAnalysis);
  return row;
}

// An editor's browser saves what it measured in a video reference, and the strip of frames it drew (a JPEG of at
// most styleSheetBytes), or null when it drew none. Every number is checked, and the measurements replace any saved
// before. A strip with no plan of its frames is refused; a plan with no strip is dropped. The reference is ready.
export async function saveVideoAnalysis(db: DB, actor: Actor, id: string, analysis: unknown, sheet: Uint8Array | null): Promise<StyleReference> {
  requireRole(actor, "editor");
  await videoRow(db, actor, id);
  const parsed = VideoAnalysis.safeParse(analysis);
  if (!parsed.success) throw invalid(STYLE_MESSAGES.badAnalysis);
  if (sheet !== null) {
    if (sheet.byteLength > LIMITS.styleSheetBytes) throw invalid(STYLE_MESSAGES.sheetTooBig);
    if (!isJpeg(sheet) || parsed.data.sheet === null) throw invalid(STYLE_MESSAGES.badAnalysis);
  }
  const facts = sheet === null ? { ...parsed.data, sheet: null } : parsed.data;
  const [row] = await db
    .update(styleReference)
    .set({ status: "ready", failure: null, analysis: facts, sheet: sheet === null ? null : Uint8Array.from(sheet), updatedAt: new Date() })
    .where(and(eq(styleReference.id, id), eq(styleReference.spaceId, actor.spaceId)))
    .returning(REFERENCE_COLUMNS);
  if (!row) throw referenceGone();
  return toReference(row);
}

// Why a video couldn't be measured, as it is kept: on one line, at most styleShortTextChars. null when nothing
// storable is left, and the page says it in its own words.
function failureOf(reason: string): string | null {
  const line = titleOf(typeof reason === "string" ? reason : "");
  return line !== "" && isStorableText(line) ? line : null;
}

// An editor's browser gives up measuring a video reference, saying why in plain words. A video already measured
// keeps what was measured (another browser may have finished it): only a pending or failed one is marked failed.
export async function failVideoAnalysis(db: DB, actor: Actor, id: string, reason: string): Promise<StyleReference> {
  requireRole(actor, "editor");
  const before = await videoRow(db, actor, id);
  if (before.status === "ready") return toReference(before);
  const [row] = await db
    .update(styleReference)
    .set({ status: "failed", failure: failureOf(reason), updatedAt: new Date() })
    .where(and(eq(styleReference.id, id), eq(styleReference.spaceId, actor.spaceId), ne(styleReference.status, "ready")))
    .returning(REFERENCE_COLUMNS);
  return toReference(row ?? (await liveRow(db, actor, id)));
}

// Every address a link's video may be kept at. A YouTube video goes by its watch page, or by its Shorts page when it
// was pasted as a Short, and both are the same video.
function addressesOf(link: VideoLink): string[] {
  if (link.provider !== "youtube") return [link.url];
  return [`https://www.youtube.com/watch?v=${link.id}`, `https://www.youtube.com/shorts/${link.id}`];
}

// The kept references that are the same video as a link, however it was written. A Vimeo video goes by its id, kept
// with or without an unlisted video's private part (https://vimeo.com/123 and https://vimeo.com/123/abc are one
// video); its id is only digits, so it can't stand for anything else in a pattern.
function sameVideo(link: VideoLink): SQL {
  if (link.provider !== "vimeo") return inArray(styleReference.url, addressesOf(link));
  const plain = `https://vimeo.com/${link.id}`;
  return or(eq(styleReference.url, plain), like(styleReference.url, `${plain}/%`))!;
}

// An editor adds a public YouTube, Vimeo or TikTok link. Its site is asked for the video's public title, author and
// picture; nothing is downloaded. A link the site says nothing about is still kept, with its address as the title
// (its analysis says unreadable). Instagram links, TikTok share links and anything else are refused, saying what to
// do instead. The same video twice is refused, however its link is written: an unlisted Vimeo video's share link
// too, when the video is already kept without its private part (removing that one makes room for the share link).
export async function addLinkReference(db: DB, actor: Actor, url: string, fetchFn: typeof fetch = fetch): Promise<StyleReference> {
  requireRole(actor, "editor");
  const link = parseVideoLink(url);
  if (!link.ok) throw invalid(linkRefusalMessage(link.reason));
  await checkNew(db, actor, sameVideo(link));
  await checkRoom(db, actor);
  const facts = await fetchLinkFacts(link, fetchFn);
  return insertReference(db, actor, {
    kind: "link",
    title: titleOf(facts.title),
    url: link.url,
    provider: link.provider,
    author: facts.author ?? null,
    thumbnailUrl: facts.thumbnailUrl ?? null,
    analysis: facts,
    fetchedAt: new Date(facts.fetchedAt),
  });
}

// What the editor counts in a past project, read without the parts it doesn't need (its transcripts and color
// tables, the biggest parts of a timeline).
const LEAN_DOC = sql<TimelineDoc>`(${projects.doc} #- '{captions,transcripts}') - 'luts'`;

// An editor adds one of the space's past projects. Its timeline is counted now (shots, text, captions, transitions,
// music, speed changes, looks and effects), so the reference is ready at once.
export async function addProjectReference(db: DB, actor: Actor, projectId: string): Promise<StyleReference> {
  requireRole(actor, "editor");
  const [project] = await db
    .select({ name: projects.name, doc: LEAN_DOC })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.spaceId, actor.spaceId), isNull(projects.deletedAt)));
  if (!project) throw new ServiceError("NOT_FOUND", 404, STYLE_MESSAGES.projectGone);
  await checkNew(db, actor, eq(styleReference.projectId, projectId));
  await checkRoom(db, actor);

  const sounds = everyClip(project.doc).flatMap((clip) => (clip.type === "audio" ? [clip.assetId] : []));
  const facts = await loadAssetFacts(db, actor.spaceId, sounds);
  const kinds: AssetKinds = Object.fromEntries([...facts.values()].map((fact) => [fact.id, fact.kind]));
  const analysis = ProjectAnalysis.parse(projectFacts(project.doc, kinds));
  return insertReference(db, actor, { kind: "project", title: titleOf(project.name), projectId, analysis });
}

// One upload of the space's connected YouTube channel, as YouTube describes it: its address, title and channel name,
// picture, length in seconds, description and tags, and whether it is a Short.
export type ChannelVideo = {
  url: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  seconds?: number;
  description?: string;
  tags?: string[];
  short?: boolean;
};

// Words from YouTube as they are kept: control characters and direction overrides out, on one line, at most max
// characters with "…" when longer. undefined when nothing is left.
function fitted(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = value
    .toWellFormed()
    .replace(/[\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
  if (line === "") return undefined;
  return line.length <= max ? line : withSuffix(line, "…", max);
}

// The facts a channel upload's reference keeps, cut to fit: at most ANALYSIS_LIMITS.tags tags, a picture only from
// YouTube's image servers, a length only when it is one a reference can have. Pure.
export function channelFacts(link: VideoLink, video: ChannelVideo, now: Date): LinkAnalysis {
  const title = fitted(video.title, LIMITS.styleShortTextChars) ?? link.url;
  const author = fitted(video.author, LIMITS.styleShortTextChars);
  const thumbnailUrl = thumbnailAddress(video.thumbnailUrl) ?? undefined;
  const rounded = typeof video.seconds === "number" ? Math.round(video.seconds * 100) / 100 : Number.NaN;
  const seconds = rounded > 0 && rounded <= ANALYSIS_LIMITS.seconds ? rounded : undefined;
  const description = fitted(video.description, ANALYSIS_LIMITS.descriptionChars);
  const tags = [...new Set((video.tags ?? []).flatMap((tag) => fitted(tag, ANALYSIS_LIMITS.tagChars) ?? []))].slice(0, ANALYSIS_LIMITS.tags);
  return LinkAnalysis.parse({
    kind: "link",
    provider: "channel",
    title,
    ...(author !== undefined ? { author } : {}),
    ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
    ...(seconds !== undefined ? { seconds } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...((video.short ?? link.short) ? { short: true } : {}),
    fetchedAt: now.toISOString(),
  });
}

// An editor adds an upload of the space's connected YouTube channel, with what YouTube's own data says about it
// (read by the caller with the channel's permission). Adding one that is already there from the channel refreshes
// its facts, at either of its addresses; one that was pasted as a link is already added.
export async function addChannelReference(db: DB, actor: Actor, video: ChannelVideo, now: Date = new Date()): Promise<StyleReference> {
  requireRole(actor, "editor");
  const link = parseVideoLink(video.url);
  if (!link.ok || link.provider !== "youtube") throw invalid(STYLE_MESSAGES.badLink);
  const facts = channelFacts(link, video, now);
  const values = {
    title: facts.title,
    author: facts.author ?? null,
    thumbnailUrl: facts.thumbnailUrl ?? null,
    analysis: facts,
    fetchedAt: now,
  };
  const addresses = addressesOf(link);
  const [refreshed] = await db
    .update(styleReference)
    .set({ ...values, updatedAt: now })
    .where(and(eq(styleReference.spaceId, actor.spaceId), inArray(styleReference.url, addresses), eq(styleReference.provider, "channel")))
    .returning({ id: styleReference.id });
  if (refreshed) return toReference(await liveRow(db, actor, refreshed.id));
  await checkNew(db, actor, inArray(styleReference.url, addresses));
  await checkRoom(db, actor);
  return insertReference(db, actor, { kind: "link", url: link.url, provider: "channel", ...values });
}

// An editor takes a reference out of the space's style, with what was learned from it.
export async function removeReference(db: DB, actor: Actor, id: string): Promise<void> {
  requireRole(actor, "editor");
  const removed = await db
    .delete(styleReference)
    .where(and(eq(styleReference.id, id), eq(styleReference.spaceId, actor.spaceId)))
    .returning({ id: styleReference.id });
  if (removed.length === 0) throw referenceGone();
}

// A video reference's strip of frames, a JPEG, for any member. null when it has none, or is not one of the space's.
export async function referenceSheet(db: DB, actor: Actor, id: string): Promise<Uint8Array<ArrayBuffer> | null> {
  requireRole(actor, "viewer");
  const [row] = await db
    .select({ sheet: styleReference.sheet })
    .from(styleReference)
    .leftJoin(assets, eq(assets.id, styleReference.assetId))
    .leftJoin(projects, eq(projects.id, styleReference.projectId))
    .where(and(isLive(actor.spaceId), eq(styleReference.id, id)));
  return row?.sheet ?? null;
}

// The space a reference belongs to, so its routes can find the member's role there. null for an unknown one. No role
// check: the caller checks the member next.
export async function spaceOfReference(db: DB, id: string): Promise<string | null> {
  const [row] = await db.select({ spaceId: styleReference.spaceId }).from(styleReference).where(eq(styleReference.id, id));
  return row?.spaceId ?? null;
}

// One measured video's strip of frames, for an agent to look at: the reference it belongs to, its title, the JPEG,
// and which moment of the video each frame is from.
export type ReferenceSheet = { referenceId: string; title: string; jpeg: Uint8Array<ArrayBuffer>; plan: SheetPlan | null };

// A space's style as agents read it: the style, everything it learns from, and the strips of frames of the newest
// AGENT_SHEETS measured videos.
export type StyleForAgents = Style & { references: StyleReference[]; sheets: ReferenceSheet[] };

// The space's style, references and newest frame strips, for an agent. No role check: the caller has checked the
// agent's member already.
export async function styleForAgents(db: DB, spaceId: string, now: Date = new Date()): Promise<StyleForAgents> {
  const style = await readStyle(db, spaceId);
  const references = await shownReferences(db, await liveRows(db, spaceId), now);
  const rows = await db
    .select({ id: styleReference.id, title: styleReference.title, analysis: styleReference.analysis, sheet: styleReference.sheet })
    .from(styleReference)
    .leftJoin(assets, eq(assets.id, styleReference.assetId))
    .leftJoin(projects, eq(projects.id, styleReference.projectId))
    .where(and(isLive(spaceId), eq(styleReference.kind, "video"), eq(styleReference.status, "ready"), isNotNull(styleReference.sheet)))
    .orderBy(...newestFirst)
    .limit(AGENT_SHEETS);
  const sheets = rows.flatMap((row): ReferenceSheet[] => {
    if (!row.sheet) return [];
    const analysis = VideoAnalysis.safeParse(row.analysis);
    return [{ referenceId: row.id, title: row.title, jpeg: row.sheet, plan: analysis.success ? analysis.data.sheet : null }];
  });
  return { ...style, references, sheets };
}
