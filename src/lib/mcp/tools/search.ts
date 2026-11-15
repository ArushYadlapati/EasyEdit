import { z } from "zod";
import { listAssets } from "@/lib/media/service";
import type { AssetView } from "@/lib/media/types";
import { listFolders } from "@/lib/projects/folders";
import { listProjects, type ProjectSummary } from "@/lib/projects/service";
import { actorInSpace } from "../actors";
import { oneLine } from "../one-line";
import { spaceLabel } from "../space-label";
import { ok, type ToolContext, type ToolResult } from "../types";

// search and fetch are the two read-only tools ChatGPT's deep research and company knowledge look for, in the shapes
// OpenAI documents. Any agent may use them. An id names its kind: "project:<id>" or "asset:<id>".
export const SEARCH_RESULTS_MAX = 20;

export const SearchOutput = z.object({
  results: z.array(z.object({ id: z.string(), title: z.string(), url: z.string() })),
});
type SearchResult = z.infer<typeof SearchOutput>["results"][number];

export const projectItemId = (id: string) => `project:${id}`;
export const assetItemId = (id: string) => `asset:${id}`;

// Where a person opens the item. Media has no page of its own: it is in the Media tab of every project, so its link is
// the app, with the asset named so each result keeps a link of its own.
export const projectUrl = (ctx: ToolContext, id: string) => `${ctx.baseUrl}/editor/${id}`;
export const assetUrl = (ctx: ToolContext, id: string) => `${ctx.baseUrl}/dashboard#asset-${id}`;

// The words a query is matched by, lower case, without punctuation around them. One-letter words match too much to
// count, unless they are all the query has.
function termsOf(query: string): string[] {
  const words = query
    .split(/\s+/)
    .map((word) => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ""))
    .filter((word) => word.length > 0);
  const long = words.filter((word) => [...word].length > 1);
  return [...new Set(long.length > 0 ? long : words)];
}

type Hit = { result: SearchResult; phrase: boolean; score: number };

// How well an item matches: whether its name holds the whole query, and how many of the words its fields hold.
function hit(result: SearchResult, query: string, terms: string[], name: string, fields: string[]): Hit {
  const text = fields.join("\n").toLowerCase();
  return { result, phrase: name.toLowerCase().includes(query), score: terms.filter((term) => text.includes(term)).length };
}

// Projects by name or folder name, and ready media by name or event. An item matches when it holds any word of the
// query. Names that hold the whole query come first, then items holding more of the words; on a tie, projects come
// before media, and newer before older. An empty query gives the most recently changed projects.
export async function searchTool(ctx: ToolContext, input: { query: string }): Promise<ToolResult> {
  const query = input.query.trim().replace(/\s+/g, " ").toLowerCase();
  const terms = termsOf(query);
  const spaces = await everySpace(ctx);
  const projects = spaces.flatMap((s) => s.projects.map((p) => ({ ...p, space: s.name }))).sort(newestChangeFirst);
  const projectResult = (p: { id: string; name: string; space: string }): SearchResult => ({
    id: projectItemId(p.id),
    title: titled(p.name, p.space),
    url: projectUrl(ctx, p.id),
  });
  if (terms.length === 0) return answer(projects.slice(0, SEARCH_RESULTS_MAX).map(projectResult));

  const folders = new Map(spaces.flatMap((s) => s.folders.map((folder) => [folder.id, folder.name] as const)));
  const library = spaces.flatMap((s) => s.assets.map((a) => ({ ...a, space: s.name }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? -1 : 1));
  const assetResult = (a: AssetView & { space: string }): SearchResult => ({ id: assetItemId(a.id), title: titled(a.name, a.space), url: assetUrl(ctx, a.id) });
  const hits = [
    ...projects.map((p) => hit(projectResult(p), query, terms, p.name, [p.name, p.folderId === null ? "" : (folders.get(p.folderId) ?? "")])),
    ...library.map((a) => hit(assetResult(a), query, terms, a.name, [a.name, a.event ?? ""])),
  ].filter((h) => h.score > 0);
  // Array sort is stable, so ties keep the order above.
  hits.sort((a, b) => Number(b.phrase) - Number(a.phrase) || b.score - a.score);
  return answer(hits.slice(0, SEARCH_RESULTS_MAX).map((h) => h.result));
}

function answer(results: SearchResult[]): ToolResult {
  return ok(JSON.stringify({ results } satisfies z.infer<typeof SearchOutput>));
}

// A result's title says which space it is in.
const titled = (name: string, space: string) => `${oneLine(name)} (${spaceLabel(space)})`;

const newestChangeFirst = (a: ProjectSummary, b: ProjectSummary) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? -1 : 1);

// What a search looks through in each of the person's spaces.
async function everySpace(ctx: ToolContext) {
  return Promise.all(
    ctx.spaces.map(async (space) => {
      const actor = actorInSpace(ctx, space.id)!;
      const [projects, folders, assets] = await Promise.all([listProjects(ctx.db, actor), listFolders(ctx.db, actor), listAssets(ctx.db, actor)]);
      return { name: space.name, projects, folders, assets: assets.filter((a) => a.status === "ready" && !a.removed) };
    }),
  );
}
