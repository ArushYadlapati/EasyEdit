# Connect an AI agent

A member can connect an AI agent to the app and ask it to read and change projects for them. Claude is the main one, but anything that speaks MCP works: ChatGPT, Claude Code, Cursor, VS Code (Copilot), Codex, Gemini CLI, the OpenAI API, or another MCP client. Each agent works as that member, with their role. A member can connect as many agents as they like, and each one is listed and disconnected on its own.

The **AI agents** page (account menu → **AI agents**, or `/agents`) shows the server address, step-by-step setup for each agent (Claude first), every agent the member has connected, and their access tokens.

**Before deploying a version with the connector:** run the migration against the database first (`pnpm db:migrate`, with the production `DATABASE_URL` as in [Deploy to Vercel](deploy.md), step 4), then deploy. With the tables missing, sign-in fails, and the version with access tokens fails on `/agents` and on token calls.

**Add Claude (recommended):**

1. In claude.ai open **Settings**, then **Connectors**, then **Add custom connector**.
2. Enter exactly `<BETTER_AUTH_URL>/api/mcp`, for example `https://your-app.vercel.app/api/mcp`. Add it, then click **Connect**.
3. Sign in with Google if you are asked to.
4. Check the "Connect Claude" page: it names your account and says what Claude will be able to do. Press **Allow**.

**Add another agent:** open the **AI agents** page, pick the agent and follow its steps. Agents that sign in (ChatGPT, Claude Code, Cursor, VS Code, Codex, Gemini CLI) open the same consent page, titled with their name. Agents that can only send a header (the OpenAI Responses API and Agents SDK, scripts, automation tools) use an **access token**: make one on the AI agents page, copy it once, and send it as `Authorization: Bearer <token>`. Tokens start with `ee_at_`, are stored only as a hash, last 90 days unless the member picks 30 days, a year or no end date, and can be revoked on the same page. A token works like the member's password for that agent: anyone holding it acts as the member until it ends or is revoked.

**What an agent can do:**

| Tool | What it does |
| --- | --- |
| `list_projects` | Lists the team's projects, newest change first, and says who you are signed in as. |
| `get_project` | Reads one project's timeline as text: tracks, clips, times and the current version. |
| `create_project` | Creates an empty project with a name and one of the five formats, or a custom width and height in pixels, or starts one from a template and lists the slots to fill. |
| `edit_timeline` | Applies a list of changes to a project, all or nothing. |
| `add_text` | Adds one or more text clips from a preset (title, subtitle or lower third). |
| `undo_change` | Undoes one earlier change, an agent's or a person's, like **Undo this change** in the editor. |
| `list_assets` | Lists the team's uploaded video, images and audio, newest first, with each one's id, kind, length and size. |
| `add_media` | Puts one or more uploaded files on a project's timeline, laid end to end unless the agent gives start times. |
| `list_templates` | Lists the templates of the member's spaces, the three starters and the saved ones, with each one's slots. |
| `get_template` | Reads one template: its notes for the agent, its slots with hints and its timeline. |
| `fill_template` | Fills a project's slots in one change: text for a text slot, an uploaded file for a video, image or audio slot. It says which slots are still empty and which footage is shorter than its slot. |
| `get_editing_guide` | Reads the guide to how projects are built and what is possible today. With `space`, the guide ends with that space's style. With `topic`, reads one topic of the video skills instead; topic `"style"` with a space reads the space's style in full, with pictures of frames from its videos. |
| `save_style` | Saves a space's style: its summary, fields and notes, and up to five video links to learn from. Editors and admins only. |
| `search` | Finds projects and media by name. ChatGPT's deep research uses it. |
| `fetch` | Reads one search result in full. ChatGPT's deep research uses it. |

No agent can watch or hear footage. A space's style is the exception for the person's own videos (see below), and captions are the exception for speech: an agent reads each caption line in `get_project`, turns captions on for a clip with `edit_timeline` when the file already has saved captions (a person creates them with **Auto captions** in the editor's Captions tab), fixes words and restyles them. The editing guide's Captions section teaches this.

**Video skills:** a skill teaches an agent how to make good videos. The `easyedit-video` skill has 14 topics: hooks, pacing, captions, on-screen text, b-roll, music and sound, transitions and motion, color and looks, story shapes, platforms, editing in someone's style, learning a style, accessibility, and a final check before handing a video back. Each one names the real tools and ops, with numbers and examples.

- Connected agents have them with nothing to install. The guide ends with a **Skills** list, one line per topic, and `get_editing_guide` with `topic` (for example `"hooks"`) sends that topic in full. An unknown topic is answered with the list of topics.
- Each topic is also a prompt named by its id, which Claude Code shows as a slash command, and a resource at `easyedit://skills/<id>`. `easyedit://skills` is the skill's `SKILL.md`. Prompts and resources don't count toward the tool list.
- Claude Code installs the plugin, which brings the skill and the connector: `/plugin marketplace add ArushYadlapati/EasyEdit`, then `/plugin install easyedit@easyedit`.
- Codex, Cursor, Gemini CLI and Copilot read skills from a folder: download `/skills/easyedit-video.zip` (public, no sign-in) and unzip it into `~/.agents/skills`. On claude.ai, upload the same zip under **Settings → Capabilities → Skills**.

The AI agents page shows these steps under **Video skills**. The files live in `plugins/easyedit/skills/easyedit-video/` (`SKILL.md`, and one file per topic under `references/`); `node scripts/make-skills.mjs` copies them into `src/lib/skills/library.generated.ts`, which the server sends, and a test fails while that copy is out of date.

**A space's style:** each space can keep a style that agents follow, kept on the space's **Settings → Style** page. Anyone in the space can read it, and editors and admins change it, the same as the brand kit.

- `get_editing_guide` with `space` (a slug as `list_projects` shows it, or `"personal"`) adds **This space's style** to the end of the guide: the fields, the notes as quoted text, who changed it last, and one line of facts for each video, link or past project it learns from. With nothing saved, it ends with one line pointing at the Style page. A space the member isn't in is answered like one that doesn't exist, and while personal spaces are coming soon the personal space is refused.
- `get_editing_guide` with `topic` `"style"` and a space gives the style alone, with more facts per reference, and then up to six frame sheets (the newest measured videos) as JPEG pictures. A text line names each sheet's video and the time of each frame, so an agent that can't show pictures (ChatGPT drops them) still gets every number.
- Text that came from outside (titles, authors, descriptions and tags from video sites, the first words heard in a video, the notes people typed) is always quoted and kept on one line, so it reads as content, never as instructions.
- `save_style` takes `space` and any of `summary`, `fields` (style fields as the Style page has them; each one given replaces the saved one, and `null` clears it), `notes` and `add_links`. A field or notes the style can't take is refused with the Style page's own words (a field it doesn't have, with the list of fields there are), and nothing is saved. Links are then added side by side: a link that can't be added (Instagram, a page that isn't a video, a video already there or named twice, no room left) is named with the reason, and the rest still go in. A viewer's agent is told it can read the style but not change it. The answer says what changed and links the Style page. Agents are told to save only after the person agrees, and the tool is marked as one that can take things away, since it can clear fields and replace notes.
- `get_project`'s first page says when the project's space has a saved style, and how to read it.
- Two prompts start the work: **learn-my-style** (`space`, and optional `links` separated by commas) reads the style and its references, asks at most two questions, proposes a style and saves it with the links once the person agrees. **edit-in-my-style** (`space`, and an optional `project`) reads the guide with the space and the project, says the plan in three bullets, then makes it one change at a time.

**Roles:** everyone in a space can edit, so their agents can create and change projects there. Every change an agent makes is listed in the editor's **Activity** with the agent's name, for example "Claude (for <name>)" or "ChatGPT (for <name>)", and can be undone there. A change from an agent is refused if the project changed since it last read it, and it is told what changed, so it never overwrites an edit it has not seen.

**Moving projects:** agents can't move a project to another space; a person does it from the project's menu. Changes made before a move can't be undone afterwards, by people or by `undo_change`.

**Limits:** through agents, each member gets 30 changes a minute, 10 MB of change data a day and 50 new projects a day. One page of a read is 16,000 characters; longer projects come in several pages. Saving a style isn't counted in those; a style learns from at most 12 videos, links and past projects, and `save_style` adds at most 5 links a call.

**Ending a connection:** on the **AI agents** page a member disconnects one agent or revokes one token, and the others keep working. The Admin page shows "Connected" next to each member with any agent or token; an admin's **Disconnect** there ends all of that member's agents and tokens at once, and removing a member ends them too. Removing the connector inside an agent stops it from using it, but it stays listed until it is disconnected here. Signing out of the website does not end a connection.

**Which agents can connect.** The sign-in server only sends a member back to an address it knows: each agent's callback address or app link (for example `https://claude.ai/api/mcp/auth_callback`, `https://chatgpt.com/connector_platform_oauth_redirect` or `cursor://anysphere.cursor-mcp/oauth/callback`), or a loopback address on the member's own computer (`http://127.0.0.1:<port>/…` or `http://localhost:<port>/…`, with no query), which the command-line agents use. VS Code's `https://vscode.dev/redirect` is on the list because VS Code registers it; that page passes a code on only to a loopback address or to a VS Code extension, so a member who allows VS Code also trusts the extensions installed in it. Apps may register themselves, but a registration is refused unless every callback address is on that list (at most 10, each at most 512 characters, with a name of at most 100). Registration ignores logo, policy and other descriptive addresses, and apps that registered more than a week ago but were never allowed are cleaned up the next time any app registers. The consent page names the agent only when its own published description or its callback address proves it, otherwise it shows the name the app gave itself in quotes, and it always says where the member will be sent next. Client metadata documents are read only from the hosts on the list (claude.ai, claude.com, chatgpt.com, vscode.dev, zed.dev and goose-docs.ai). The consent page is always shown, and the allowlist is checked on every request. The list is in `src/lib/connector/agents.ts`; adding an agent means adding it there.
