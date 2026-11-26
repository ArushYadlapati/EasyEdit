# EasyEdit for AI agents

[EasyEdit](https://easyedit.arush.dev) is a video editor in the browser for creators and small teams. Your AI agent can work in it with you: it reads your projects and makes real edits that you watch land in the editor, and you can undo any of them.

This folder gives an agent two things:

- **The EasyEdit connector**, at `https://easyedit.arush.dev/api/mcp`. That's how the agent reaches your projects.
- **The `easyedit-video` skill**: how to edit Shorts, Reels, TikToks and YouTube videos well. Strong openings, pace, captions, on-screen text, b-roll, music and sound, transitions, color, story shapes, each platform's rules, accessibility and a last check before handing back. It also teaches the agent to edit in your space's saved Style, and to learn that Style from your videos, links and past projects.

## What's inside

```
plugins/easyedit/
├── .claude-plugin/plugin.json   the Claude Code plugin
├── .mcp.json                    the EasyEdit connector
└── skills/easyedit-video/
    ├── SKILL.md                 where the agent starts
    └── references/              one file per topic, read when needed
```

## Install

### Claude Code

```
/plugin marketplace add ArushYadlapati/EasyEdit
/plugin install easyedit@easyedit
```

That adds the skill and the connector together. Then run `/mcp`, pick **easyedit**, choose **Authenticate**, sign in and choose **Allow**.

### Codex, Cursor, Gemini CLI and VS Code (Copilot)

Copy `skills/easyedit-video` into `~/.agents/skills/`, or download [easyedit-video.zip](https://easyedit.arush.dev/skills/easyedit-video.zip) and unzip it there.

These agents need the connector added on its own. In EasyEdit, open the account menu → **AI agents** (or [easyedit.arush.dev/agents](https://easyedit.arush.dev/agents)), pick your agent and follow its steps.

### Claude (claude.ai, desktop and phone)

Download [easyedit-video.zip](https://easyedit.arush.dev/skills/easyedit-video.zip), then upload it under **Settings → Capabilities → Skills**.

For the connector, open **Settings → Connectors → Add custom connector**, name it EasyEdit, paste `https://easyedit.arush.dev/api/mcp`, then choose **Connect** and **Allow**.

## Already connected? You're set

An agent connected to EasyEdit gets the same topics with nothing to install. It calls `get_editing_guide` with a topic, such as "hooks", and EasyEdit sends that topic back. Each topic is also a prompt (a slash command in Claude Code) and a resource at `easyedit://skills/<topic>`. Installing the skill means your agent knows them before it connects, and knows when to reach for each one.

## Your style

Each space can save a Style: how your videos usually look, sound and move. Set it up in EasyEdit in the space's settings, under **Style**. Add videos from your media (EasyEdit looks at them in your browser), paste YouTube, Vimeo or TikTok links (it reads only their public title and picture), pick past projects, or add videos from your YouTube channel where posting is set up. Then fill in the fields, or press **Fill in from my videos**.

Or ask your agent to learn it for you: the **learn-my-style** prompt does that. It shows you what it found, and saves it only when you say yes. To edit in your style, ask "Edit my latest project in the <space> style." or use the **edit-in-my-style** prompt. The agent reads the style with `get_editing_guide` and your space, before its first edit.

## Privacy

The connector acts as you, with your role in each space. See the [Privacy Policy](https://easyedit.arush.dev/privacy) and [Terms](https://easyedit.arush.dev/terms).

## License

MIT. See [LICENSE](../../LICENSE).
