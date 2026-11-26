import { meetsRole } from "@/lib/access-rules";
import { LIMITS } from "@/lib/limits";
import { ServiceError } from "@/lib/service-error";
import { linkAddresses, liveReferenceCount } from "@/lib/style/agent";
import { describeProfile } from "@/lib/style/fields";
import { linkRefusalMessage, parseVideoLink, type VideoLink } from "@/lib/style/links";
import { STYLE_MESSAGES } from "@/lib/style/messages";
import { addLinkReference, getStyle, updateStyle } from "@/lib/style/service";
import { STYLE_PROFILE_KEYS, isSetValue, type StylePatch, type StyleProfile, type StyleReference } from "@/lib/style/types";
import { withSuffix } from "@/lib/text";
import { escapeQuoted } from "@/lib/timeline";
import { oneLine } from "../one-line";
import { quotedSpace } from "../space-label";
import { stylePageUrl, styleSpace } from "../style-space";
import { notesLines } from "../style-text";
import { fail, ok, type SpaceToolContext, type ToolContext, type ToolResult } from "../types";

// What save_style takes. fields is checked against the style's own rules here, not by the tool's schema, so the tool
// list stays small; summary is the summary field, given on its own because it is the one most often written.
export type SaveStyleInput = { space: string; summary?: string; fields?: Record<string, unknown>; notes?: string; add_links?: string[] };

// The most links one call adds.
export const STYLE_LINKS_PER_CALL = 5;

// The answer to a call that names nothing to save.
export const NOTHING_TO_SAVE = "Nothing to save. Pass summary, fields, notes or add_links.";
const NOTHING_SAVED = "Nothing was saved.";

// The longest a link or a field name the agent sent is echoed back: past this it is cut, with "…".
const ECHO_CHARS = 120;

const quoted = (text: string) => `"${escapeQuoted(oneLine(text))}"`;
// Text the agent sent, quoted back to it: cut to ECHO_CHARS, so a long one isn't repeated whole.
const echo = (text: string) => {
  const line = oneLine(text);
  return quoted(line.length <= ECHO_CHARS ? line : withSuffix(line, "…", ECHO_CHARS));
};

// What an agent acting for someone who can only read the space is told.
export function styleRoleMessage(role: string, spaceName: string): string {
  return `Your role in ${quotedSpace(spaceName)} is ${role}, so you can read its style but not change it. Give the person your draft to pass on to an editor or admin of the space. ${NOTHING_SAVED}`;
}

// What an agent is told when fields names something a style doesn't have: the fields there are, and where to read
// what each one takes.
export function unknownFields(keys: string[]): string {
  const names = keys.map(echo).join(", ");
  return `A style has no ${keys.length === 1 ? "field" : "fields"} ${names}. Its fields are ${STYLE_PROFILE_KEYS.join(", ")}; get_editing_guide with topic "learn-a-style" says what each one takes. ${NOTHING_SAVED}`;
}

// Where a link came from, as the answer names it.
const SITE_NAMES: Record<string, string> = { youtube: "YouTube", vimeo: "Vimeo", tiktok: "TikTok", channel: "YouTube" };

// One link's line in the answer: added, skipped (already there), or refused and why. A refusal is the Style page's
// own words.
type LinkOutcome = { status: "added" | "skipped" | "refused"; line: string };

const notAdded = (link: string, why: string): LinkOutcome => ({ status: "refused", line: `- Not added: ${echo(link)}. ${why}` });
const skipped = (link: string, why: string): LinkOutcome => ({ status: "skipped", line: `- Skipped ${echo(link)}: ${why}` });
const SAME_VIDEO = "it's the same video as a link above.";

// Which video a link is, however it was written: a YouTube video by its id (its watch page and its Shorts page are
// one video), any other by the one address its site gives it.
const videoKey = (link: VideoLink) => (link.provider === "youtube" ? `youtube:${link.id}` : link.url);

// The videos the style already learns from links to, by videoKey.
async function knownVideos(ctx: SpaceToolContext): Promise<Set<string>> {
  const addresses = await linkAddresses(ctx.db, ctx.actor.spaceId);
  return new Set(addresses.map((address) => {
    const parsed = parseVideoLink(address);
    return parsed.ok ? videoKey(parsed) : address;
  }));
}

async function addLink(ctx: SpaceToolContext, link: string): Promise<LinkOutcome> {
  try {
    const reference: StyleReference = await addLinkReference(ctx.db, ctx.actor, link, ctx.fetch ?? fetch);
    const site = reference.provider ? ` (${SITE_NAMES[reference.provider]})` : "";
    const unreadable = reference.analysis?.kind === "link" && reference.analysis.unreadable === true;
    return { status: "added", line: `- Added ${quoted(reference.title)}${site}.${unreadable ? ` ${STYLE_MESSAGES.linkUnreadable}` : ""}` };
  } catch (error) {
    if (!(error instanceof ServiceError)) return notAdded(link, "Something went wrong on our side. Try it again in a moment.");
    if (error.message === STYLE_MESSAGES.alreadyAdded) return skipped(link, error.message);
    return notAdded(link, error.message);
  }
}

// Adds the links side by side, as many as the style has room for. Each add counts the references before it saves, so
// adding five at once into a style with room for two would let all five in: links past the room are refused here
// instead, in order. A link that can't be read, a video the style already has, and a second link to a video named
// earlier in the call are answered without asking any site, and never take a place. Two calls at the same moment can
// still go over.
async function addLinks(ctx: SpaceToolContext, links: string[]): Promise<LinkOutcome[]> {
  const [count, known] = await Promise.all([liveReferenceCount(ctx.db, ctx.actor.spaceId), knownVideos(ctx)]);
  const named = new Set<string>();
  let room = LIMITS.styleReferences - count;
  return Promise.all(
    links.map((link) => {
      const parsed = parseVideoLink(link);
      if (!parsed.ok) return notAdded(link, linkRefusalMessage(parsed.reason));
      const key = videoKey(parsed);
      if (known.has(key)) return skipped(link, STYLE_MESSAGES.alreadyAdded);
      if (named.has(key)) return skipped(link, SAME_VIDEO);
      if (room <= 0) return notAdded(link, STYLE_MESSAGES.tooManyReferences);
      named.add(key);
      room -= 1;
      return addLink(ctx, link);
    }),
  );
}

// What a save changed in the fields: the lines for the fields now set (as get_editing_guide shows them), and the
// fields taken off.
function changes(before: StyleProfile, after: StyleProfile): { set: string[]; cleared: string[] } {
  const changed = STYLE_PROFILE_KEYS.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  const now = Object.fromEntries(changed.filter((key) => isSetValue(after[key])).map((key) => [key, after[key]])) as StyleProfile;
  return { set: describeProfile(now), cleared: changed.filter((key) => !isSetValue(after[key])) };
}

// An editor's agent saves a space's style: fields (each one given replaces the saved one, null clears it), the
// summary, the notes, and up to five video links to learn from. Bad fields or notes are refused with the Style page's
// own words and nothing is saved, links included. Links are added after that, side by side: one that can't be added
// is named with why, and the rest still go in. The answer says what changed and links the Style page. A call that
// changes nothing says so; it is refused only when a link it asked for couldn't go in.
export async function saveStyleTool(base: ToolContext, input: SaveStyleInput): Promise<ToolResult> {
  const found = styleSpace(base, input.space);
  if ("error" in found) return fail(found.error);
  const { space, ctx } = found;
  if (!meetsRole(ctx.actor.role, "editor")) return fail(styleRoleMessage(ctx.actor.role, space.name));

  const unknown = Object.keys(input.fields ?? {}).filter((key) => !(STYLE_PROFILE_KEYS as string[]).includes(key));
  if (unknown.length > 0) return fail(unknownFields(unknown));
  const profile = { ...(input.fields ?? {}), ...(input.summary !== undefined && { summary: input.summary }) };
  const patch: StylePatch = {
    ...(Object.keys(profile).length > 0 && { profile: profile as StylePatch["profile"] }),
    ...(input.notes !== undefined && { notes: input.notes }),
  };
  const links = [...new Set((input.add_links ?? []).map((link) => link.trim()).filter((link) => link !== ""))];
  if (patch.profile === undefined && patch.notes === undefined && links.length === 0) return fail(NOTHING_TO_SAVE);
  if (links.length > STYLE_LINKS_PER_CALL) return fail(`At most ${STYLE_LINKS_PER_CALL} links per call. ${NOTHING_SAVED}`);

  const lines: string[] = [];
  let changed = false;
  let fieldsUnchanged = false;
  if (patch.profile !== undefined || patch.notes !== undefined) {
    const before = await getStyle(ctx.db, ctx.actor);
    let after;
    try {
      after = await updateStyle(ctx.db, ctx.actor, patch);
    } catch (error) {
      if (error instanceof ServiceError) return fail(`${error.message} ${NOTHING_SAVED}`);
      throw error;
    }
    const { set, cleared } = changes(before.profile, after.profile);
    const notesChanged = after.notes !== before.notes;
    if (set.length > 0) lines.push("Changed:", ...set.map((line) => `- ${line}`));
    if (cleared.length > 0) lines.push(`Cleared: ${cleared.join(", ")}.`);
    if (notesChanged) lines.push(...(after.notes === "" ? ["Notes: cleared."] : notesLines(after.notes)));
    changed = set.length > 0 || cleared.length > 0 || notesChanged;
    fieldsUnchanged = !changed;
  }

  let refused = false;
  if (links.length > 0) {
    const outcomes = await addLinks(ctx, links);
    if (outcomes.some((outcome) => outcome.status === "added")) changed = true;
    refused = outcomes.some((outcome) => outcome.status === "refused");
    lines.push("Links:", ...outcomes.map((outcome) => outcome.line));
  }

  const name = quotedSpace(space.name);
  const page = `Give the person the Style page, where they can see and change it: ${stylePageUrl(ctx, space)}`;
  if (changed) {
    const same = fieldsUnchanged ? ["The fields and notes already said that, so they stay as they were."] : [];
    return ok([`Saved the style for ${name}.`, ...same, ...lines, page].join("\n"));
  }
  if (refused) return fail([`Nothing was saved to the style for ${name}.`, ...lines, page].join("\n"));
  return ok([`Nothing changed: the style for ${name} already says all that.`, ...lines, page].join("\n"));
}
