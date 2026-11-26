import { LIMITS } from "@/lib/limits";
import { isJpeg } from "@/lib/projects/thumbnails";
import { skillTopic, TOPIC_IDS } from "@/lib/skills";
import { getStyle, listReferences, styleForAgents } from "@/lib/style/service";
import { escapeQuoted } from "@/lib/timeline";
import { buildEditingGuide } from "../guide";
import { oneLine } from "../one-line";
import { stylePageUrl, styleSpace } from "../style-space";
import { isStyleSaved, noStyleLine, noStyleYet, sheetLines, STYLE_TOPIC, styleSection } from "../style-text";
import { fail, ok, okWithImages, type ToolContext, type ToolImage, type ToolResult } from "../types";

// What get_editing_guide takes: optionally, a topic of the video skill by its id (or "style"), and a space whose
// saved style to add.
export type GuideInput = { topic?: string; space?: string };

// The topic an agent asked for, forgiving of case, spacing and a file name: "Hooks", " hooks ", "references/hooks.md",
// "music and sound" and "music_and_sound" all name a topic by its id.
const topicId = (topic: string) =>
  topic
    .trim()
    .toLowerCase()
    .replace(/^references\//, "")
    .replace(/\.md$/, "")
    .replace(/[\s_]+/g, "-");

// Topic "style" without a space.
export const STYLE_NEEDS_SPACE =
  'Topic "style" needs a space: pass space as list_projects shows it (the project\'s space), or "personal".';

const given = (text: string | undefined) => (text !== undefined && text.trim() !== "" ? text : undefined);

// The whole guide; with a topic, that topic of the video skill in full. With a space, the guide ends with that space's
// style (or a line saying it has none). Topic "style" with a space is the style alone, in full, with the frame sheets
// of its newest measured videos as pictures after the text. An unknown topic lists the ones there are.
export async function getEditingGuideTool(ctx: ToolContext, input: GuideInput): Promise<ToolResult> {
  const topic = given(input.topic);
  const space = given(input.space);
  if (topic !== undefined && topicId(topic) === STYLE_TOPIC) return space === undefined ? fail(STYLE_NEEDS_SPACE) : styleTopic(ctx, space);
  if (topic !== undefined) {
    const found = skillTopic(topicId(topic));
    if (!found) return fail(`No topic "${escapeQuoted(oneLine(topic))}". Topics: ${TOPIC_IDS.join(", ")}, and ${STYLE_TOPIC} (with a space).`);
    return ok(found.body);
  }
  if (space === undefined) return ok(buildEditingGuide());
  return guideWithStyle(ctx, space);
}

// The guide, then the space's style as one line of facts per reference. The frame sheets' pictures stay out of it
// (and out of the database read): only whether there are any is needed, to point at topic "style".
async function guideWithStyle(base: ToolContext, slug: string): Promise<ToolResult> {
  const found = styleSpace(base, slug);
  if ("error" in found) return fail(found.error);
  const { space, ctx } = found;
  const style = await getStyle(ctx.db, ctx.actor);
  const references = await listReferences(ctx.db, ctx.actor, ctx.now());
  const stylePage = stylePageUrl(ctx, space);
  if (!isStyleSaved(style, references)) return ok(`${buildEditingGuide()}\n\n${noStyleLine(stylePage)}`);
  const sheets = references.filter((r) => r.kind === "video" && r.status === "ready" && r.hasSheet).length;
  const section = styleSection({ spaceName: space.name, style, references, sheets, stylePage, now: ctx.now() });
  return ok([buildEditingGuide(), "", ...section].join("\n"));
}

const asImage = (jpeg: Uint8Array): ToolImage => ({ data: Buffer.from(jpeg).toString("base64"), mimeType: "image/jpeg" });

// A strip that may be handed to an agent as a JPEG picture: one that is a JPEG, no bigger than a strip may be. The
// service checks both when a strip is saved; this keeps anything else in the database from going out as an image.
const isHandable = (jpeg: Uint8Array) => isJpeg(jpeg) && jpeg.byteLength <= LIMITS.styleSheetBytes;

// The space's style in full, then its frame sheets as pictures, in the order the text names them.
async function styleTopic(base: ToolContext, slug: string): Promise<ToolResult> {
  const found = styleSpace(base, slug);
  if ("error" in found) return fail(found.error);
  const { space, ctx } = found;
  const read = await styleForAgents(ctx.db, space.id, ctx.now());
  const stylePage = stylePageUrl(ctx, space);
  if (!isStyleSaved(read, read.references)) return ok(noStyleYet(stylePage));
  const sheets = read.sheets.filter((sheet) => isHandable(sheet.jpeg));
  const section = styleSection({ spaceName: space.name, style: read, references: read.references, sheets: sheets.length, stylePage, now: ctx.now() }, true);
  const text = [...section, ...sheetLines(sheets)].join("\n");
  return okWithImages(text, sheets.map((sheet) => asImage(sheet.jpeg)));
}
