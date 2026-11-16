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
| `create_project` | Creates an empty project with a name and one of the five formats, or a custom width and height in pixels. |
| `edit_timeline` | Applies a list of changes to a project, all or nothing. |
| `add_text` | Adds one or more text clips from a preset (title, subtitle or lower third). |
| `undo_change` | Undoes one earlier change, an agent's or a person's, like **Undo this change** in the editor. |
| `list_assets` | Lists the team's uploaded video, images and audio, newest first, with each one's id, kind, length and size. |
| `add_media` | Puts one or more uploaded files on a project's timeline, laid end to end unless the agent gives start times. |
| `get_editing_guide` | Reads the guide to how projects are built and what is possible today. |
| `search` | Finds projects and media by name. ChatGPT's deep research uses it. |
| `fetch` | Reads one search result in full. ChatGPT's deep research uses it. |

No agent can see inside footage yet.

**Roles:** everyone in a space can edit, so their agents can create and change projects there. Every change an agent makes is listed in the editor's **Activity** with the agent's name, for example "Claude (for <name>)" or "ChatGPT (for <name>)", and can be undone there. A change from an agent is refused if the project changed since it last read it, and it is told what changed, so it never overwrites an edit it has not seen.

**Limits:** through agents, each member gets 30 changes a minute, 10 MB of change data a day and 50 new projects a day. One page of a read is 16,000 characters; longer projects come in several pages.

**Ending a connection:** on the **AI agents** page a member disconnects one agent or revokes one token, and the others keep working. The Admin page shows "Connected" next to each member with any agent or token; an admin's **Disconnect** there ends all of that member's agents and tokens at once, and removing a member ends them too. Removing the connector inside an agent stops it from using it, but it stays listed until it is disconnected here. Signing out of the website does not end a connection.

**Which agents can connect.** The sign-in server only sends a member back to an address it knows: each agent's callback address or app link (for example `https://claude.ai/api/mcp/auth_callback`, `https://chatgpt.com/connector_platform_oauth_redirect` or `cursor://anysphere.cursor-mcp/oauth/callback`), or a loopback address on the member's own computer (`http://127.0.0.1:<port>/…` or `http://localhost:<port>/…`, with no query), which the command-line agents use. VS Code's `https://vscode.dev/redirect` is on the list because VS Code registers it; that page passes a code on only to a loopback address or to a VS Code extension, so a member who allows VS Code also trusts the extensions installed in it. Apps may register themselves, but a registration is refused unless every callback address is on that list (at most 10, each at most 512 characters, with a name of at most 100). Registration ignores logo, policy and other descriptive addresses, and apps that registered more than a week ago but were never allowed are cleaned up the next time any app registers. The consent page names the agent only when its own published description or its callback address proves it, otherwise it shows the name the app gave itself in quotes, and it always says where the member will be sent next. Client metadata documents are read only from the hosts on the list (claude.ai, claude.com, chatgpt.com, vscode.dev, zed.dev and goose-docs.ai). The consent page is always shown, and the allowlist is checked on every request. The list is in `src/lib/connector/agents.ts`; adding an agent means adding it there.
