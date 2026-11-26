import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { LIMITS } from "@/lib/limits";
import { SKILL_DESCRIPTION, SKILL_MD, SKILL_TOPICS } from "@/lib/skills";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { FormatId } from "@/lib/timeline";
import { UNEXPECTED } from "./errors";
import { EDIT_DESCRIPTION, buildEditingGuide } from "./guide";
import { editInMyStylePrompt, learnMyStylePrompt } from "./style-prompts";
import { withStructuredContent } from "./structured";
import { addMediaTool } from "./tools/add-media";
import { addTextTool } from "./tools/add-text";
import { createProjectTool } from "./tools/create-project";
import { editTimelineTool } from "./tools/edit-timeline";
import { FetchOutput, fetchTool } from "./tools/fetch";
import { getEditingGuideTool } from "./tools/get-editing-guide";
import { getProjectTool } from "./tools/get-project";
import { listAssetsTool } from "./tools/list-assets";
import { listProjectsTool } from "./tools/list-projects";
import { saveStyleTool, STYLE_LINKS_PER_CALL } from "./tools/save-style";
import { SEARCH_RESULTS_MAX, SearchOutput, searchTool } from "./tools/search";
import { fillTemplateTool, getTemplateTool, listTemplatesTool } from "./tools/templates";
import { undoChangeTool } from "./tools/undo-change";
import type { ToolContext, ToolResult } from "./types";

// A database error code (such as "22021"), on the error or its cause. Only a short plain token is taken.
function errorCode(error: unknown): string | undefined {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    const code = (candidate as { code?: unknown } | null)?.code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)) return code;
  }
  return undefined;
}

// Every tool answers through here, and Claude reads UNEXPECTED when one throws. The text comes first, then one image
// block per picture, so a client that drops pictures still reads the whole answer.
// The log gets the tool name, the error's class and its database code. Never the error itself, its message or its stack:
// a failed query's message holds the values bound to it, which are the tool's arguments.
function answer<Input>(name: string, tool: (input: Input) => Promise<ToolResult>) {
  return async (input: Input) => {
    try {
      const { text, isError, images = [] } = await tool(input);
      const pictures = images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType }));
      return { content: [{ type: "text" as const, text }, ...pictures], isError };
    } catch (error) {
      const kind = error instanceof Error ? error.constructor.name : typeof error;
      const code = errorCode(error);
      console.error("Connector tool failed", name, kind, ...(code ? [code] : []));
      return { content: [{ type: "text" as const, text: UNEXPECTED }], isError: true };
    }
  };
}

const GUIDE_URI = "easyedit://editing-guide";
const SKILLS_URI = "easyedit://skills";

export function registerTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_editing_guide",
    {
      title: "Editing guide",
      description:
        "How to edit well in this app: how a project is built, what is possible today, and rules for short videos. Read it once before your first edit in a conversation, with the project's space for that space's style. Pass topic for a skill; the guide lists them.",
      inputSchema: z.object({ topic: z.string().max(40).optional(), space: z.string().max(100).optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    answer("get_editing_guide", (input) => getEditingGuideTool(ctx, input)),
  );

  server.registerPrompt(
    "editing-guide",
    { title: "Editing guide", description: "Load the EasyEdit editing guide into the conversation." },
    () => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: buildEditingGuide() } }] }),
  );

  server.registerResource(
    "editing-guide",
    GUIDE_URI,
    { title: "Editing guide", mimeType: "text/markdown" },
    () => ({ contents: [{ uri: GUIDE_URI, mimeType: "text/markdown", text: buildEditingGuide() }] }),
  );

  // The video skill: SKILL.md as a resource, and each topic as a prompt (a slash command in some agents) and a resource.
  // Neither counts toward the tool list.
  server.registerResource(
    "skills",
    SKILLS_URI,
    { title: "Video skills", description: SKILL_DESCRIPTION, mimeType: "text/markdown" },
    () => ({ contents: [{ uri: SKILLS_URI, mimeType: "text/markdown", text: SKILL_MD }] }),
  );
  for (const topic of SKILL_TOPICS) {
    const uri = `${SKILLS_URI}/${topic.id}`;
    server.registerPrompt(topic.id, { title: topic.title, description: topic.summary }, () => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text: topic.body } }],
    }));
    server.registerResource(`skills-${topic.id}`, uri, { title: topic.title, description: topic.summary, mimeType: "text/markdown" }, () => ({
      contents: [{ uri, mimeType: "text/markdown", text: topic.body }],
    }));
  }

  // Two ways to start on a space's style: learn it from the person's videos, or edit a project the way it says.
  const spaceArg = z.string().min(1).max(100).describe('The space\'s slug as list_projects shows it, or "personal".');
  const userMessage = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });
  server.registerPrompt(
    "learn-my-style",
    {
      title: "Learn my style",
      description: "Look at a space's videos, links and past projects, suggest a style, and save it once you agree.",
      argsSchema: z.object({ space: spaceArg, links: z.string().max(2000).optional().describe("Video links to learn from too, separated by commas.") }),
    },
    ({ space, links }) => userMessage(learnMyStylePrompt(space, links)),
  );
  server.registerPrompt(
    "edit-in-my-style",
    {
      title: "Edit in my style",
      description: "Plan and make an edit that follows a space's saved style.",
      argsSchema: z.object({ space: spaceArg, project: z.string().max(200).optional().describe("The project to edit, by id or name. Left out, the space's most recent one.") }),
    },
    ({ space, project }) => userMessage(editInMyStylePrompt(space, project)),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List the video projects in all of the person's spaces (their personal space and their teams), most recently changed first, with each project's id, space, format and version. Also says who you are signed in as and the spaces you can use. Start here when the person has not named a project.",
      inputSchema: z.object({ cursor: z.number().int().min(0).optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    answer("list_projects", (input) => listProjectsTool(ctx, input)),
  );

  server.registerTool(
    "get_project",
    {
      title: "Read a project",
      description:
        "Read one project's timeline as text: its format, version, tracks and clips, with times in seconds and in frames and every clip's id. Call this before changing a project, and pass the version it reports as expected_version. Long projects come in pages: to read on, pass the cursor and the version that the last line of a page names. If the project changed in between, you are told to start again.",
      inputSchema: z.object({
        project_id: z.string().min(1),
        cursor: z.number().int().min(0).optional(),
        version: z.number().int().min(0).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    answer("get_project", (input) => getProjectTool(ctx, input)),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description:
        "Create an empty project with a name and a format: short_9x16 (1080×1920, Reels and Shorts), feed_4x5 (1080×1350), square_1x1 (1080×1080), long_16x9 (1920×1080), long_4k (3840×2160), or custom with a width and height in pixels: even numbers from 16 to 4096, at most the area of 3840×2160. Returns the new project's id, its version (0) and its starting tracks. " +
        // Which space: named, or asked about when the person has more than one.
        (personalSpacesOpen()
          ? "Pass space: a space's slug as list_projects shows it, or \"personal\". "
          : "Pass space: a team's slug as list_projects shows it. Personal spaces are coming soon and take no new projects. ") +
        "If you leave out space and the person has more than one, you'll be asked to check with them. " +
        "To use a team's media, create the project in that team (pass its space). Or pass a template instead of a format.",
      // The range tells Claude the limits; evenness and the area are answered by the service's sentence.
      inputSchema: z.object({
        name: z.string(),
        format: FormatId.optional(),
        template: z.string().max(100).optional(),
        width: z.number().int().min(LIMITS.frameSideMin).max(LIMITS.frameSideMax).optional(),
        height: z.number().int().min(LIMITS.frameSideMin).max(LIMITS.frameSideMax).optional(),
        space: z.string().max(100).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    answer("create_project", (input) => createProjectTool(ctx, input)),
  );

  server.registerTool(
    "list_templates",
    {
      title: "List templates",
      description:
        "List project templates: the built-in starters and each space's saved ones.",
      inputSchema: z.object({ space: z.string().max(100).optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    answer("list_templates", (input) => listTemplatesTool(ctx, input)),
  );

  server.registerTool(
    "get_template",
    {
      title: "Read a template",
      description:
        "Read one template by id: notes, slots and timeline.",
      inputSchema: z.object({ template: z.string().min(1).max(100), space: z.string().max(100).optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    answer("get_template", (input) => getTemplateTool(ctx, input)),
  );

  server.registerTool(
    "fill_template",
    {
      title: "Fill template slots",
      description:
        "Fill the slots of a project made from a template.",
      inputSchema: z.object({
        project_id: z.string().min(1),
        expected_version: z.number().int().min(0),
        slots: z
          .array(
            z.object({
              slot: z.string().min(1).max(100),
              text: z.string().max(LIMITS.textClipChars).optional(),
              asset_id: z.string().min(1).optional(),
              in_seconds: z.number().min(0).optional(),
            }),
          )
          .min(1)
          .max(50),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    answer("fill_template", (input) => fillTemplateTool(ctx, input)),
  );

  server.registerTool(
    "edit_timeline",
    {
      title: "Edit the timeline",
      description: EDIT_DESCRIPTION,
      inputSchema: z.object({
        project_id: z.string().min(1),
        expected_version: z.number().int().min(0),
        ops: z.array(z.record(z.string(), z.unknown())).min(1).max(LIMITS.opsPerRequest),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    answer("edit_timeline", (input) => editTimelineTool(ctx, input)),
  );

  server.registerTool(
    "add_text",
    {
      title: "Add text",
      description:
        "Add one or more text clips from a preset (title, subtitle, body or lower-third), in the space's brand kit fonts, at a time given in seconds. It finds a free text track or makes one. Defaults: preset title, start 0, 3 seconds. Use this for plain text; use edit_timeline to restyle or move it afterwards. Needs expected_version, like edit_timeline.",
      inputSchema: z.object({
        project_id: z.string().min(1),
        expected_version: z.number().int().min(0),
        items: z
          .array(
            z.object({
              text: z.string().min(1).max(LIMITS.textClipChars),
              preset: z.enum(["title", "subtitle", "body", "lower-third"]).optional(),
              start_seconds: z.number().min(0).optional(),
              duration_seconds: z.number().positive().optional(),
              track_id: z.string().min(1).optional(),
            }),
          )
          .min(1)
          .max(LIMITS.connectorTextItems),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    answer("add_text", (input) => addTextTool(ctx, input)),
  );

  server.registerTool(
    "list_assets",
    {
      title: "List media",
      description:
        'List the uploaded video, images and audio in all of the person\'s spaces, newest first, with each asset\'s id, kind, length and size. Filter by kind, or by a word in the name or event. Use an id from here in add_media, or as "assetId" in a media clip for edit_timeline. You cannot see inside footage yet: go by names, events and lengths.',
      inputSchema: z.object({
        kind: z.enum(["video", "image", "audio"]).optional(),
        search: z.string().max(100).optional(),
        cursor: z.number().int().min(0).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    answer("list_assets", (input) => listAssetsTool(ctx, input)),
  );

  server.registerTool(
    "add_media",
    {
      title: "Add media",
      description:
        "Put one or more assets from list_assets on the timeline. Times are in seconds. Each item takes asset_id and, optionally, start_seconds, in_seconds (where in the footage to begin), duration_seconds and track_id. Without start_seconds, an item goes right after the one before it; the first goes after what is already on its track. Video and audio default to their full length, images to 3 seconds. It finds a free track of the right kind or makes one. Needs expected_version, like edit_timeline.",
      inputSchema: z.object({
        project_id: z.string().min(1),
        expected_version: z.number().int().min(0),
        items: z
          .array(
            z.object({
              asset_id: z.string().min(1),
              start_seconds: z.number().min(0).optional(),
              in_seconds: z.number().min(0).optional(),
              duration_seconds: z.number().positive().optional(),
              track_id: z.string().min(1).optional(),
            }),
          )
          .min(1)
          .max(LIMITS.connectorMediaItems),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    answer("add_media", (input) => addMediaTool(ctx, input)),
  );

  server.registerTool(
    "undo_change",
    {
      title: "Undo a change",
      description:
        "Undo one earlier change to a project, by the version that change produced (edit results and conflict reports name versions). Works for your changes and for other people's, like the editor's Activity list. It is refused if that part of the project was changed afterwards. Needs expected_version, like edit_timeline.",
      inputSchema: z.object({
        project_id: z.string().min(1),
        expected_version: z.number().int().min(0),
        version: z.number().int().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    answer("undo_change", (input) => undoChangeTool(ctx, input)),
  );

  server.registerTool(
    "save_style",
    {
      title: "Save a space's style",
      description:
        "Save a space's style, which get_editing_guide gives agents. Pass space and any of: summary, fields (style fields; null clears one), notes, add_links (video links to learn from). Notes and each field (lists too) replace the saved value whole, so read the style first and send back the full text with your change. Ask the person first.",
      // fields is checked against the style's rules when it is saved, so its schema here stays small.
      inputSchema: z.object({
        space: z.string().max(100),
        summary: z.string().optional(),
        fields: z.record(z.string(), z.unknown()).optional(),
        notes: z.string().optional(),
        add_links: z.array(z.string()).max(STYLE_LINKS_PER_CALL).optional(),
      }),
      // It can clear fields and replace the notes people typed, so it isn't only additive. It reads outside sites: a
      // link's public details come from YouTube, Vimeo or TikTok.
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    answer("save_style", (input) => saveStyleTool(ctx, input)),
  );

  // The two tools ChatGPT's deep research and company knowledge read a server with, in the shapes OpenAI documents.
  server.registerTool(
    "search",
    {
      title: "Search projects and media",
      description: `Find video projects (by name or folder name) and uploaded media (by name or event) in all of the person's spaces. Returns up to ${SEARCH_RESULTS_MAX} results as JSON {"results":[{"id","title","url"}]}, best match first. An empty query gives the most recently changed projects. Read a result with fetch.`,
      inputSchema: z.object({ query: z.string().max(500) }),
      outputSchema: SearchOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withStructuredContent(answer("search", (input: { query: string }) => searchTool(ctx, input))),
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch a project or media",
      description:
        'Read one search result by its id ("project:<id>" or "asset:<id>"). A project comes back as its timeline in text, like get_project; media as its kind, length, size and event. Returns JSON {"id","title","text","url","metadata"}.',
      inputSchema: z.object({ id: z.string().min(1) }),
      outputSchema: FetchOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withStructuredContent(answer("fetch", (input: { id: string }) => fetchTool(ctx, input))),
  );
}
