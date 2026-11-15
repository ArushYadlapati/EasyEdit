import { z } from "zod";
import { sourceFrames } from "@/lib/media/rules";
import { listAssets } from "@/lib/media/service";
import type { AssetView } from "@/lib/media/types";
import { getProject } from "@/lib/projects/service";
import { timeAgo } from "@/lib/time-ago";
import { DEFAULT_FPS, escapeQuoted } from "@/lib/timeline";
import { assetReason, notFoundText } from "../errors";
import { oneLine } from "../one-line";
import { projectPage } from "../project-text";
import { actorInSpace, projectContext } from "../actors";
import { spaceLabel, spaceNames } from "../space-label";
import { fail, ok, type ToolContext, type ToolResult } from "../types";
import { assetItemId, assetUrl, projectItemId, projectUrl } from "./search";

export const FetchOutput = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  url: z.string(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
type Fetched = z.infer<typeof FetchOutput>;

const answer = (item: Fetched): ToolResult => ok(JSON.stringify(item));

const quoted = (text: string) => `"${escapeQuoted(oneLine(text))}"`;

export function unknownItemText(id: string): string {
  return `No project or media with id ${quoted(id)}. Ids from search look like "project:<id>" or "asset:<id>".`;
}

// One item from search, by its id. A bare id, as the other tools print them, is tried as a project and then as media.
export async function fetchTool(ctx: ToolContext, input: { id: string }): Promise<ToolResult> {
  const named = /^(project|asset):([\s\S]+)$/.exec(input.id);
  if (named?.[1] === "project") return (await fetchProject(ctx, named[2])) ?? fail(notFoundText(oneLine(named[2])));
  if (named?.[1] === "asset") return assetResult(ctx, named[2], await findAsset(ctx, named[2]));
  const project = await fetchProject(ctx, input.id);
  if (project) return project;
  const found = await findAsset(ctx, input.id);
  return found ? assetResult(ctx, input.id, found) : fail(unknownItemText(input.id));
}

// The same text as get_project's first page. A longer project ends with how to read on with get_project.
async function fetchProject(ctx: ToolContext, id: string): Promise<ToolResult | null> {
  const pc = await projectContext(ctx, id);
  const project = pc && (await getProject(pc.db, pc.actor, id));
  if (!project) return null;
  return answer({
    id: projectItemId(project.id),
    title: oneLine(project.name),
    text: projectPage(project, { maxChars: ctx.limits.connectorReadChars }).text,
    url: projectUrl(ctx, project.id),
    metadata: { kind: "project", space: spaceNames(ctx).get(pc!.actor.spaceId) ?? "", version: project.version, format: project.format, updatedAt: project.updatedAt.toISOString() },
  });
}

type Found = { asset: AssetView; space: string };

// Media in the library of any of the person's spaces: never another member's unfinished upload, which the library
// service leaves out. Media of a space the person is not in is not found, like media that never existed.
async function findAsset(ctx: ToolContext, id: string): Promise<Found | null> {
  for (const space of ctx.spaces) {
    const actor = actorInSpace(ctx, space.id)!;
    const [asset] = await listAssets(ctx.db, actor, { ids: [id] });
    if (asset) return { asset, space: space.name };
  }
  return null;
}

// Removed media and unfinished uploads are refused in the words add_media uses.
function assetResult(ctx: ToolContext, id: string, found: Found | null): ToolResult {
  if (!found) return fail(assetReason("missing", id));
  const { asset, space } = found;
  if (asset.removed) return fail(assetReason("removed", id));
  if (asset.status !== "ready") return fail(assetReason("not_ready", id));
  return assetAnswer(ctx, asset, space);
}

const KIND_LABEL = { video: "Video", image: "Image", audio: "Audio" } as const;

function assetAnswer(ctx: ToolContext, asset: AssetView, space: string): ToolResult {
  const facts: string[] = [KIND_LABEL[asset.kind]];
  if (asset.kind !== "image" && asset.durationMs !== null) {
    facts.push(`${(asset.durationMs / 1000).toFixed(2)}s (${sourceFrames(asset.durationMs, DEFAULT_FPS)} frames at ${DEFAULT_FPS} fps)`);
  }
  if (asset.kind !== "audio" && asset.width !== null && asset.height !== null) facts.push(`${asset.width}x${asset.height}`);
  if (asset.kind === "video") facts.push(asset.hasAudio ? "with sound" : "no sound");

  const lines = [`Media ${quoted(asset.name)} (id ${asset.id})`, facts.join(" · ")];
  if (asset.event !== null) lines.push(`Event ${quoted(asset.event)}`);
  lines.push(`File ${quoted(asset.fileName)} · ${(asset.sizeBytes / 1_000_000).toFixed(1)} MB`);
  lines.push(spaceLabel(space));
  lines.push(`Uploaded ${timeAgo(new Date(asset.createdAt), ctx.now())} by ${oneLine(asset.uploadedByName)}`);
  lines.push(`Put it on a timeline with add_media, asset_id "${asset.id}". You cannot see inside footage yet: go by its name, event and length.`);

  return answer({
    id: assetItemId(asset.id),
    title: oneLine(asset.name),
    text: lines.join("\n"),
    url: assetUrl(ctx, asset.id),
    metadata: {
      kind: "asset",
      space,
      mediaKind: asset.kind,
      durationMs: asset.durationMs,
      width: asset.width,
      height: asset.height,
      event: asset.event,
      uploadedAt: asset.createdAt,
    },
  });
}
