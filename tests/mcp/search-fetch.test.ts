import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { LIMITS } from "@/lib/limits";
import { registerTools } from "@/lib/mcp/server";
import { fetchTool } from "@/lib/mcp/tools/fetch";
import { getProjectTool } from "@/lib/mcp/tools/get-project";
import { SEARCH_RESULTS_MAX, searchTool } from "@/lib/mcp/tools/search";
import type { ToolContext, ToolResult } from "@/lib/mcp/types";
import { createFolder } from "@/lib/projects/folders";
import { applyProjectOps, createProject, deleteProject, getProject, listProjects } from "@/lib/projects/service";
import type { OpInput } from "@/lib/timeline";
import { makeTestDb } from "../helpers/db";
import { insertAsset } from "../media/context";
import { addText, fillWithText, toolContext } from "./context";

const grace = { userId: "u2", email: "u2@gmail.com", role: "editor" as const };
// The test database's clock counts whole milliseconds, so changes meant to sort apart need a gap.
const nextMillisecond = () => new Promise((resolve) => setTimeout(resolve, 5));

const NOW = new Date("2026-11-12T12:00:00Z");
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const IMAGE_ROW = { kind: "image", fileName: "field.jpg", mimeType: "image/jpeg", sizeBytes: 3_000_000, durationMs: null, width: 4032, height: 3024, fps: null, videoCodec: null, hasAudio: false, previewStatus: "none" } as const;

type Result = { id: string; title: string; url: string };

function json(result: ToolResult) {
  expect(result.isError, result.text).toBe(false);
  return JSON.parse(result.text);
}
const search = async (ctx: ToolContext, query: string): Promise<Result[]> => json(await searchTool(ctx, { query })).results;
const idsOf = (results: Result[]) => results.map((r) => r.id);

describe("search", () => {
  it("finds a project by part of its name, in the shape ChatGPT reads", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const recap = await createProject(db, grace, { name: "Qualifier recap", format: "short_9x16" });
    await createProject(db, grace, { name: "Season opener", format: "long_16x9" });

    const result = await searchTool(ctx, { query: "QUALIF" });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ results: [{ id: `project:${recap.id}`, title: "Qualifier recap", url: `https://studio.test/editor/${recap.id}` }] });
    expect(await search(ctx, "intake")).toEqual([]);
  });

  it("matches folder names, media names and events; whole-name matches first; never removed or unfinished media", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const folder = await createFolder(db, grace, "Worlds 2026");
    const inFolder = await createProject(db, grace, { name: "Intake reveal", format: "short_9x16", folderId: folder.id });
    await nextMillisecond();
    const named = await createProject(db, grace, { name: "Worlds recap", format: "short_9x16" });
    await createProject(db, grace, { name: "Season opener", format: "short_9x16" });
    const pit = await insertAsset(db, { ...IMAGE_ROW, name: "Worlds pit" });
    const byEvent = await insertAsset(db, { name: "IMG_1", event: "Worlds" });
    await insertAsset(db, { name: "worlds old", removedAt: NOW, removedBy: "u1" });
    await insertAsset(db, { name: "worlds raw", status: "uploading", readyAt: null, uploadUrl: "https://upload.test/s", uploadedBy: "u2" });

    const results = await search(ctx, "worlds");
    expect(idsOf(results)).toEqual([`project:${named.id}`, `asset:${pit}`, `project:${inFolder.id}`, `asset:${byEvent}`]);
    expect(results[1]).toEqual({ id: `asset:${pit}`, title: "Worlds pit", url: `https://studio.test/dashboard#asset-${pit}` });
  });

  it("ranks items holding more of the words first, and ignores one-letter words and punctuation", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const qualifier = await createProject(db, grace, { name: "Qualifier recap", format: "short_9x16" });
    await nextMillisecond();
    const reel = await createProject(db, grace, { name: "Recap reel", format: "short_9x16" });
    await createProject(db, grace, { name: "Banana", format: "short_9x16" });

    expect(idsOf(await search(ctx, "the qualifier recap video?"))).toEqual([`project:${qualifier.id}`, `project:${reel.id}`]);
    expect(idsOf(await search(ctx, "a  recap"))).toEqual([`project:${reel.id}`, `project:${qualifier.id}`]);
    expect(idsOf(await search(ctx, '"recap reel"'))).toEqual([`project:${reel.id}`, `project:${qualifier.id}`]);
    // A one-letter query is all the query has, so it counts.
    expect(idsOf(await search(ctx, "b"))).toEqual(idsOf(await search(ctx, "banana")));
  });

  it("an empty query gives the most recently changed projects, at most 20, and no media", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    for (let i = 0; i < 25; i++) {
      await createProject(db, grace, { name: `Project ${i}`, format: "short_9x16" });
      await nextMillisecond();
    }
    await insertAsset(db, { name: "Project footage" });
    const recent = (await listProjects(db, grace)).slice(0, SEARCH_RESULTS_MAX).map((p) => `project:${p.id}`);
    expect(SEARCH_RESULTS_MAX).toBe(20);
    expect(idsOf(await search(ctx, ""))).toEqual(recent);
    expect(idsOf(await search(ctx, "  \n "))).toEqual(recent);
    expect(idsOf(await search(ctx, "?!"))).toEqual(recent);
    expect((await search(ctx, ""))[0].title).toBe("Project 24");
  });

  it("gives at most 20 results for a broad query", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    for (let i = 0; i < 30; i++) await insertAsset(db, { name: `clip ${i}` });
    expect(await search(ctx, "clip")).toHaveLength(20);
  });

  it("prints a name with a line break on one line", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const id = await insertAsset(db, { name: "drone\nshot" });
    expect(await search(ctx, "drone")).toEqual([{ id: `asset:${id}`, title: "drone shot", url: `https://studio.test/dashboard#asset-${id}` }]);
  });
});

describe("fetch", () => {
  it("returns a project as the text get_project gives, with its version, format and time", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const { id } = await createProject(db, grace, { name: "Qualifier recap", format: "short_9x16" });
    await applyProjectOps(db, grace, { projectId: id, baseVersion: 0, ops: [addText(15, "QUALIFIER RECAP", { id: "x1" }) as OpInput] });
    const project = (await getProject(db, grace, id))!;

    const fetched = json(await fetchTool(ctx, { id: `project:${id}` }));
    expect(Object.keys(fetched)).toEqual(["id", "title", "text", "url", "metadata"]);
    expect(fetched).toEqual({
      id: `project:${id}`,
      title: "Qualifier recap",
      text: (await getProjectTool(ctx, { project_id: id })).text,
      url: `https://studio.test/editor/${id}`,
      metadata: { kind: "project", version: 1, format: "short_9x16", updatedAt: project.updatedAt.toISOString() },
    });
    expect(fetched.text).toContain('x1  text  0.50–1.50s  frames 15–45  "QUALIFIER RECAP"');
    // A bare id, as list_projects prints it, reads the same.
    expect(await fetchTool(ctx, { id })).toEqual(await fetchTool(ctx, { id: `project:${id}` }));
  });

  it("returns a long project's first page, with how to read on", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const { id } = await createProject(db, grace, { name: "Long one", format: "long_16x9" });
    const version = await fillWithText(db, grace, id, 300);
    const { text } = json(await fetchTool(ctx, { id: `project:${id}` }));
    expect(text.length).toBeLessThanOrEqual(LIMITS.connectorReadChars + 400);
    expect(text.split("\n").at(-1)).toMatch(new RegExp(`Call get_project with project_id "${id}", cursor \\d+ and version ${version} to read on\\.$`));
  });

  it("returns media with its kind, length, size and event", async () => {
    const db = await makeTestDb();
    const ctx = { ...(await toolContext(db)), now: () => NOW };
    const video = await insertAsset(db, { durationMs: 12_500, event: "Qualifier 2026-11-08", createdAt: ago(48 * HOUR) });
    const image = await insertAsset(db, { ...IMAGE_ROW, name: "field", createdAt: NOW });

    expect(json(await fetchTool(ctx, { id: `asset:${video}` }))).toEqual({
      id: `asset:${video}`,
      title: "IMG_4821",
      text: [
        `Media "IMG_4821" (id ${video})`,
        "Video · 12.50s (375 frames at 30 fps) · 1080x1920 · with sound",
        'Event "Qualifier 2026-11-08"',
        'File "IMG_4821.MOV" · 20.0 MB',
        "Uploaded 2 days ago by Ada Lovelace",
        `Put it on a timeline with add_media, asset_id "${video}". You cannot see inside footage yet: go by its name, event and length.`,
      ].join("\n"),
      url: `https://studio.test/dashboard#asset-${video}`,
      metadata: { kind: "asset", mediaKind: "video", durationMs: 12_500, width: 1080, height: 1920, event: "Qualifier 2026-11-08", uploadedAt: ago(48 * HOUR).toISOString() },
    });

    const fetched = json(await fetchTool(ctx, { id: image }));
    expect(fetched.id).toBe(`asset:${image}`);
    expect(fetched.text.split("\n").slice(0, 3)).toEqual([`Media "field" (id ${image})`, "Image · 4032x3024", 'File "field.jpg" · 3.0 MB']);
    expect(fetched.metadata).toMatchObject({ mediaKind: "image", durationMs: null, event: null });
  });

  it("an unknown, deleted, removed or unfinished item is a tool error", async () => {
    const db = await makeTestDb();
    const ctx = await toolContext(db);
    const gone = await createProject(db, grace, { name: "Gone", format: "short_9x16" });
    await deleteProject(db, grace, gone.id);
    const removed = await insertAsset(db, { name: "removed", removedAt: NOW, removedBy: "u1" });
    const uploading = await insertAsset(db, { name: "uploading", status: "uploading", readyAt: null, uploadUrl: "https://upload.test/s", uploadedBy: "u2" });

    const refused = (text: string) => ({ isError: true, text });
    expect(await fetchTool(ctx, { id: "project:nope" })).toEqual(refused('No project with id "nope". It may have been deleted. Call list_projects to see the ids.'));
    expect(await fetchTool(ctx, { id: `project:${gone.id}` })).toEqual(refused(`No project with id "${gone.id}". It may have been deleted. Call list_projects to see the ids.`));
    expect(await fetchTool(ctx, { id: "asset:nope" })).toEqual(refused('No asset with id "nope". Call list_assets to see the ids.'));
    expect(await fetchTool(ctx, { id: `asset:${removed}` })).toEqual(refused(`Asset "${removed}" was removed from the library. Call list_assets to see what is there.`));
    // Another member's unfinished upload is not shown to anyone else.
    expect(await fetchTool(ctx, { id: `asset:${uploading}` })).toEqual(refused(`No asset with id "${uploading}". Call list_assets to see the ids.`));
    for (const id of ["nope", gone.id, "project:", "folder:x"]) {
      expect(await fetchTool(ctx, { id })).toEqual(refused(`No project or media with id "${id}". Ids from search look like "project:<id>" or "asset:<id>".`));
    }
    expect((await fetchTool(ctx, { id: 'a"b\nc' })).text).toBe('No project or media with id "a\\"b c". Ids from search look like "project:<id>" or "asset:<id>".');
  });

  it("a viewer can search and fetch", async () => {
    const db = await makeTestDb();
    const viewer = await toolContext(db, { id: "u9", role: "viewer" });
    const { id } = await createProject(db, grace, { name: "Read only", format: "short_9x16" });
    const asset = await insertAsset(db, { name: "read only footage" });
    expect(idsOf(await search(viewer, "read only"))).toEqual([`project:${id}`, `asset:${asset}`]);
    expect(json(await fetchTool(viewer, { id: `project:${id}` })).title).toBe("Read only");
    expect(json(await fetchTool(viewer, { id: `asset:${asset}` })).title).toBe("read only footage");
  });
});

// The tools as a client sees them: read-only, with an output schema, and the same object as text and as structured content.
async function connectedClient(db: DB) {
  const server = new McpServer({ name: "easyedit-test", version: "0.0.0" });
  registerTools(server, await toolContext(db, { role: "viewer" }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

describe("search and fetch through an MCP client", () => {
  it("are listed read-only with their output schemas, and answer in text and structured content", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, grace, { name: "Qualifier recap", format: "short_9x16" });
    const client = await connectedClient(db);
    try {
      const { tools } = await client.listTools();
      for (const name of ["search", "fetch"]) {
        const tool = tools.find((t) => t.name === name)!;
        expect(tool.annotations, name).toMatchObject({ readOnlyHint: true, openWorldHint: false });
        expect(tool.description, name).not.toMatch(/Claude/);
        expect(tool.outputSchema?.type, name).toBe("object");
      }
      expect(Object.keys(tools.find((t) => t.name === "search")!.inputSchema.properties ?? {})).toEqual(["query"]);
      expect(Object.keys(tools.find((t) => t.name === "fetch")!.inputSchema.properties ?? {})).toEqual(["id"]);

      const searched = await client.callTool({ name: "search", arguments: { query: "recap" } });
      expect(searched.isError).toBeFalsy();
      const searchText = searched.content as { type: string; text: string }[];
      expect(searchText).toHaveLength(1);
      expect(searchText[0].type).toBe("text");
      expect(searched.structuredContent).toEqual(JSON.parse(searchText[0].text));
      expect(searched.structuredContent).toEqual({ results: [{ id: `project:${id}`, title: "Qualifier recap", url: `https://studio.test/editor/${id}` }] });

      const fetched = await client.callTool({ name: "fetch", arguments: { id: `project:${id}` } });
      expect(fetched.isError).toBeFalsy();
      const fetchText = fetched.content as { type: string; text: string }[];
      expect(fetchText).toHaveLength(1);
      expect(fetched.structuredContent).toEqual(JSON.parse(fetchText[0].text));
      expect(fetched.structuredContent).toMatchObject({ id: `project:${id}`, title: "Qualifier recap", metadata: { kind: "project", version: 0 } });

      const missing = await client.callTool({ name: "fetch", arguments: { id: "project:nope" } });
      expect(missing.isError).toBe(true);
      expect(missing.structuredContent).toBeUndefined();
      expect(missing.content).toEqual([{ type: "text", text: 'No project with id "nope". It may have been deleted. Call list_projects to see the ids.' }]);
    } finally {
      await client.close();
    }
  });
});
