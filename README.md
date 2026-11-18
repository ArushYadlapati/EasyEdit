<div align="center">

# EasyEdit

**The AI-first video editor for teams, right in your browser.**

[![Website](https://img.shields.io/website?url=https%3A%2F%2Feasyedit-pi.vercel.app&label=easyedit-pi.vercel.app&style=flat-square)](https://easyedit-pi.vercel.app)
[![Version](https://img.shields.io/github/package-json/v/ArushYadlapati/EasyEdit?style=flat-square&color=blue)](package.json)
[![Last commit](https://img.shields.io/github/last-commit/ArushYadlapati/EasyEdit?style=flat-square)](https://github.com/ArushYadlapati/EasyEdit/commits/main)
[![Commit activity](https://img.shields.io/github/commit-activity/m/ArushYadlapati/EasyEdit?style=flat-square)](https://github.com/ArushYadlapati/EasyEdit/pulse)
[![Issues](https://img.shields.io/github/issues/ArushYadlapati/EasyEdit?style=flat-square)](https://github.com/ArushYadlapati/EasyEdit/issues)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

[![Next.js](https://img.shields.io/github/package-json/dependency-version/ArushYadlapati/EasyEdit/next?style=flat-square&logo=nextdotjs&logoColor=white&label=Next.js&color=000000)](https://nextjs.org)
[![React](https://img.shields.io/github/package-json/dependency-version/ArushYadlapati/EasyEdit/react?style=flat-square&logo=react&logoColor=black&label=React&color=61DAFB)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/github/package-json/dependency-version/ArushYadlapati/EasyEdit/dev/tailwindcss?style=flat-square&logo=tailwindcss&logoColor=white&label=Tailwind%20CSS&color=06B6D4)](https://tailwindcss.com)
[![Postgres](https://img.shields.io/badge/Postgres-Neon-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://neon.tech)
[![Drizzle](https://img.shields.io/badge/ORM-Drizzle-C5F74F?style=flat-square&logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![MCP](https://img.shields.io/badge/AI%20agents-MCP-D97757?style=flat-square&logo=anthropic&logoColor=white)](https://modelcontextprotocol.io)
[![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev)
[![Vercel](https://img.shields.io/badge/deployed%20on-Vercel-000000?style=flat-square&logo=vercel&logoColor=white)](https://vercel.com)

[Live app](https://easyedit-pi.vercel.app) · [Documentation](#documentation) · [Roadmap](#roadmap) · [Report a bug](https://github.com/ArushYadlapati/EasyEdit/issues)

</div>

---

## About

EasyEdit is an AI-first video editor built for teams. Everyone on a team works in the same project at the same time, footage lives in the team's Google Drive for cloud storage, and finished videos export straight from the browser. AI agents such as Claude and ChatGPT connect over MCP and do real editing work alongside you, and every change they make is listed and can be undone.

## Features

- **Multi-track timeline.** Text, video, image and audio clips on separate tracks, with trimming, splitting, ripple delete, copy and paste, snapping, and track lock, hide and mute.
- **Real-time collaboration.** Every change saves as you make it. Teammates' edits appear within about two seconds, their selections are highlighted on the timeline and preview, and anyone can undo any change from the Activity list, including a teammate's.
- **Transitions, keyframes and text animation.** Fades, crossfades, slides, zooms, whips and dips on video and image clips; keyframed position, scale, rotation and opacity, with a one-click Ken Burns move; and text that animates in, out or with emphasis. They live in the editor's Effects tab, which also lists every keyframe to edit. All of it exports as the preview shows it.
- **Templates.** Save a project with slots as a template of its space, start new projects from it, and fill the slots with your own footage and text. Three starters come built in, and AI agents can fill templates too.
- **Export in the browser.** Renders an H.264/AAC MP4 on your own machine with WebCodecs. Nothing is uploaded, and you can keep editing while it runs.
- **Shared media library.** Uploads of up to 2 GB go straight from the browser to a Google shared drive and resume after an interruption. Each video gets a 720p preview copy, so phone footage plays smoothly on any laptop.
- **Formats for every platform.** Short 9:16, Feed 4:5, Square 1:1, Long 16:9, Long 4K, or a custom size, all at 30 fps, with safe-zone guides.
- **AI agents over MCP.** Claude, ChatGPT, Cursor, VS Code, Codex and other MCP clients can list, read, create and edit projects for a signed-in member. Every agent change is listed in Activity and can be undone.
- **Roles and access control.** Viewers, editors and admins, with an Admin page for managing who can sign in.
- **Keyboard-first editing.** J/K/L playback, frame stepping, and a full shortcut list behind `?`.
- **Versioned project API.** JSON endpoints for reading projects and applying edits, with conflict detection and safe retries.

## Roadmap

Sign-up is open to anyone with a Google account. Everyone has a Personal space, with their own Google Drive storage, alongside the teams they join, and AI agents ask which space a new project goes in when you have more than one. EasyEdit moved from one team's invite-only editor to this in stages, in this order:

- [x] **Spaces.** Everyone gets a personal space alongside their teams, with a switcher between them. Every project, folder and upload belongs to one space, and only that space's members can see it. Pages move under `/s/<space>/`, and old links redirect. AI agents work across all of a person's spaces, with results labelled by space. Existing Seattle Solvers projects move into a Seattle Solvers team unchanged.
- [x] **Storage per space, and open sign-up.** Each space stores its media in a Google Drive account its owner connects. EasyEdit only asks for access to the files it creates itself, never your whole Drive. Each team gets its own read-only key, so one team can never read another's media. Once every new space can have storage, anyone with a Google account can sign up.
- [x] **Team invites.** Team admins invite people by email address with a link to send. The person signs in with that Google account and joins or declines; admins see, renew and cancel pending invites, and an invite lets someone in while sign-up is closed. An empty team can be deleted. Invites sent by email come later.
- [x] **A new sign-up flow.** Choose where your videos live and set up AI agents as you join. People invited to a team skip the storage step and land in the team.
- [x] **Moving projects between spaces.** A project's media is copied to the new space, so a project never ends up half-moved.

Also planned: thumbnails and waveforms on the timeline, captions, filters, transcripts and footage search for AI agents, and full-quality video in exports. See [Project status](docs/status.md) for what works today.

## Tech stack

| Area | Built with |
| --- | --- |
| App | [Next.js](https://nextjs.org) 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Editor state | [Zustand](https://zustand.docs.pmnd.rs) |
| Auth | [Better Auth](https://www.better-auth.com): Google sign-in, passkeys, and the OAuth server behind the AI agent connector |
| Database | Postgres on [Neon](https://neon.tech), through [Drizzle ORM](https://orm.drizzle.team) |
| Media | Google Drive API (shared drive and service account); [Mediabunny](https://mediabunny.dev) and WebCodecs for export |
| AI agents | [Model Context Protocol](https://modelcontextprotocol.io) server |
| Tests | [Vitest](https://vitest.dev), Testing Library, [PGlite](https://pglite.dev) (in-memory Postgres) |
| Hosting | [Vercel](https://vercel.com) |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 24 or newer
- [pnpm](https://pnpm.io/installation) 11
- A Google Cloud project, for the sign-in client
- A free [Neon](https://neon.tech) Postgres database

### Run it locally

1. **Clone the repository and install dependencies.**

    ```bash
    git clone https://github.com/ArushYadlapati/EasyEdit.git
    cd EasyEdit
    pnpm install
    ```

2. **Create a Google OAuth client** (type **Web application**) with this redirect URI:

    ```
    http://localhost:3000/api/auth/callback/google
    ```

    While the Google app is in Testing, add everyone who will sign in as a test user. The [setup guide](docs/setup.md#1-set-up-google-sign-in) walks through every click.

3. **Create your settings file** and fill it in:

    ```bash
    cp .env.example .env.local
    ```

    | Variable | Value |
    | --- | --- |
    | `DATABASE_URL` | Your Neon connection string, with connection pooling on |
    | `BETTER_AUTH_SECRET` | The output of `openssl rand -base64 32` |
    | `BETTER_AUTH_URL` | `http://localhost:3000` |
    | `GOOGLE_CLIENT_ID` | From your OAuth client |
    | `GOOGLE_CLIENT_SECRET` | From your OAuth client |
    | `GOOGLE_SERVICE_ACCOUNT_KEY`, `DRIVE_FOLDER_ID` | Optional. Leave them empty to run without uploads. |
    | `STORAGE_TOKEN_KEY` | Optional. For storage per space: see [Storage per space](docs/setup.md#storage-per-space). |
    | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | Optional. For posting exports to YouTube: see [Posting to YouTube](docs/setup.md#posting-to-youtube). |
    | `OPEN_SIGNUP` | Optional. Set to `true` so anyone with a Google account can sign up. Leave it unset and only the allowlist and team invites can sign in. |
    | `TUTORIAL_VIDEO_URL` | Optional. A link to the intro video: see [Tutorial video](docs/setup.md#tutorial-video). |

    Never commit `.env.local`. It holds secrets.

4. **Create the tables, add the first admin, and start the dev server.**

    ```bash
    pnpm db:migrate
    pnpm db:seed
    pnpm dev
    ```

5. **Open [http://localhost:3000](http://localhost:3000)** and sign in with Google as the admin that `pnpm db:seed` adds (`admin@seattlesolvers.com`; to use your own account, change `SEED_ADMIN_EMAIL` in `src/lib/allowlist/service.ts` before seeding). Add everyone else from the Admin page.

After pulling changes that add migrations (new files in `drizzle/`), run `pnpm db:migrate` again.

### Media uploads (optional)

Without media storage the app runs and edits as usual, and the Media tab says uploads are not set up. To turn uploads on, share a folder in a Google shared drive with a service account, then set `DRIVE_FOLDER_ID` and `GOOGLE_SERVICE_ACCOUNT_KEY` (the JSON key, base64-encoded on one line). The [setup guide](docs/setup.md#set-up-media-storage) has every step, plus a script that checks the setup end to end.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the app at http://localhost:3000 |
| `pnpm build` | Build the app for production |
| `pnpm start` | Run the built app |
| `pnpm test` | Run the test suite (no database needed) |
| `pnpm typecheck` | Check the TypeScript types |
| `pnpm lint` | Check code style |
| `pnpm db:generate` | Create a new migration after changing `src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations to the database in `DATABASE_URL` |
| `pnpm db:seed` | Add the first admin to the allowlist |
| `pnpm check:export <video.mp4> --size 1080x1920 --fps 30` | Check an exported file (needs ffmpeg) |

## Project structure

```
src/
  app/          Next.js routes: login, dashboard, admin, AI agents page, editor, and the API under api/
  components/   React components for the dashboard and editor
  db/           Drizzle schema and seed script
  lib/          Core logic: timeline model, editor, export, rendering, media, Drive, auth, MCP connector
  workers/      Web workers for export and for making video preview copies
drizzle/        SQL migrations
scripts/        Hand-run checks for Drive uploads and exported files
tests/          Vitest suites
docs/           Guides
```

## Documentation

| Guide | What it covers |
| --- | --- |
| [Setup](docs/setup.md) | Step-by-step Google, Neon, settings and media storage setup, plus a first-run checklist |
| [Deploy to Vercel](docs/deploy.md) | Deploying, and the migrations to run before each release |
| [AI agents](docs/ai-agents.md) | Connecting Claude and other MCP clients, their tools, limits and security |
| [Project API](docs/api.md) | Routes, versioned edits and error codes |
| [Roles, formats and limits](docs/reference.md) | Who can do what, video formats, and media limits |
| [Project status](docs/status.md) | What the current release can do, and what's planned next |
| [Manual checks](docs/manual-checks.md) | Click-through checks for the editor and export, and checking an exported file |
| [Troubleshooting](docs/troubleshooting.md) | Common sign-in, connector, upload and export errors |

## Contributing

Bug reports and ideas are welcome in [Issues](https://github.com/ArushYadlapati/EasyEdit/issues). To send a change:

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests where it makes sense.
3. Run `pnpm test`, `pnpm typecheck` and `pnpm lint`, and make sure they all pass.
4. For changes to the editor or export, also run the matching list in [Manual checks](docs/manual-checks.md). These need a real sign-in and browser, so the automated tests can't cover them.
5. Open a pull request that describes what changed and why.

## License

EasyEdit is open source under the [MIT License](LICENSE).
