import Link from "next/link";
import { LogoMark } from "@/components/ui/logo";
import { AgentDemo } from "./agent-demo";
import { CutBand } from "./cut-band";
import { erode } from "./erode";
import { Stage, type StageClip } from "./stage";
import styles from "./home.module.css";

// The public home page, for anyone who lands on easyedit.arush.dev signed out. Its pictures are the app itself:
// clips and stills cut from the intro tutorial's recording of the real editor (public/home), and one working model
// of the editor for the AI agent demo. The sample footage inside them is from Pexels (no credit required).

const CLIPS: Record<"ai" | "team" | "edit" | "export", StageClip> = {
  ai: {
    key: "ai",
    src: "/home/stage-ai.mp4",
    poster: "/home/stage-ai.jpg",
    status: "Claude is editing…",
    caption: "Asked for a subtitle, Claude adds it. Activity names Claude, and the change can be undone.",
    label: "A recording of the EasyEdit editor: an AI agent adds a subtitle to the video, and the change appears in Activity.",
  },
  team: {
    key: "team",
    src: "/home/stage-team.mp4",
    poster: "/home/stage-team.jpg",
    status: "Sam Okafor is editing…",
    caption: "A teammate adds a clip. Their selection shows in their colour, and the change arrives in seconds.",
    label: "A recording of the EasyEdit editor: a teammate's selection shows in pink while they add a clip.",
  },
  edit: {
    key: "edit",
    src: "/home/stage-edit.mp4",
    poster: "/home/stage-edit.jpg",
    status: "Saved",
    caption: "Typing a title and setting its font and colour. Every change saves as you make it.",
    label: "A recording of the EasyEdit editor: a title is typed on the preview and its font and colour are changed.",
  },
  export: {
    key: "export",
    src: "/home/stage-export.mp4",
    poster: "/home/stage-export.jpg",
    status: "Your video is ready.",
    caption: "The MP4 renders right in the browser, frame by frame. Nothing is uploaded.",
    label: "A recording of the EasyEdit export dialog rendering a video and saying it is ready.",
  },
};

const TEAM = [
  {
    img: "/home/presence.jpg",
    w: 820,
    h: 420,
    alt: "The editor with a pink frame and the name Sam on the clip a teammate has selected.",
    title: "See who's here",
    body: [
      "Everyone in a project shows at the top of the editor, and a teammate's selection shows in their own colour, with their name on it.",
      "Their changes reach your screen within seconds. There's no save button and no file to send around.",
    ],
  },
  {
    img: "/home/activity.jpg",
    w: 540,
    h: 370,
    alt: "The Activity list: Sam Okafor added a video clip, and you added 3 clips, each with Undo this change.",
    title: "Undo anyone's change",
    body: [
      "Activity lists every change and who made it: you, a teammate or an AI agent.",
      "Undo any one of them, even a teammate's, from the same list.",
    ],
  },
  {
    img: "/home/projects.jpg",
    w: 1580,
    h: 760,
    alt: "All projects in a team space, with the folders Competition season and Outreach above four project cards.",
    title: "A space for each team",
    body: [
      "A team space holds the team's projects, folders and media. Invite people by email and choose who's an admin.",
      "Pin a project and it stays in the sidebar for everyone. You also get a Personal space for your own videos.",
    ],
  },
  {
    img: "/home/brand-kit.jpg",
    w: 1180,
    h: 820,
    alt: "A team's brand kit: Orbitron for titles, Inter for subtitles and body text, and four brand colours.",
    title: "One brand kit",
    body: [
      "Set the team's fonts, colours and logos once. New titles start in the team's fonts.",
      "The kit sits in the editor's Brand kit tab, one click away while you edit.",
    ],
  },
];

type Row = [string, string];
const TOOLS: { name: string; rows: Row[] }[] = [
  {
    name: "Timeline",
    rows: [
      ["Split at the playhead", "S"],
      ["Trim a clip", "Drag its edge"],
      ["Delete and close the gap", "Shift Delete"],
      ["Snapping on or off", "N"],
      ["Zoom in, zoom out", "+  −"],
      ["Fit the timeline", "Shift Z"],
    ],
  },
  {
    name: "Playback",
    rows: [
      ["Play or pause", "Space"],
      ["Play backward, pause, play forward", "J  K  L"],
      ["Back or forward one frame", "←  →"],
      ["Previous or next clip edge", "↑  ↓"],
    ],
  },
  {
    name: "Tools on the rail",
    rows: [
      ["Selection", "V"],
      ["Razor: click a clip to cut it", "C"],
      ["Text: click the preview to add text", "T"],
      ["Guide: drag on the preview", "G"],
      ["Crop", "R"],
    ],
  },
  {
    name: "Text and titles",
    rows: [
      ["Title, subtitle and body text styles", "Text tab"],
      ["Type straight onto the preview", "Double-click"],
      ["Font, size, colour and alignment", "Inspect"],
      ["Typefaces to choose from", "40"],
    ],
  },
  {
    name: "Formats",
    rows: [
      ["Vertical 9:16", "1080 × 1920"],
      ["Feed 4:5", "1080 × 1350"],
      ["Square 1:1", "1080 × 1080"],
      ["Landscape 16:9", "1920 × 1080"],
      ["Landscape 4K", "3840 × 2160"],
      ["Any other size", "Custom"],
    ],
  },
  {
    name: "Media",
    rows: [
      ["Video, images and audio", "Media tab"],
      ["Shared by everyone in the space", "Library"],
      ["Stored in the space's own Google Drive", "Drive"],
    ],
  },
  {
    name: "Undo and history",
    rows: [
      ["Undo", "Cmd Z"],
      ["Redo", "Shift Cmd Z"],
      ["Every change, with who made it", "Activity"],
      ["See and change every shortcut", "?"],
    ],
  },
];

const AGENTS = ["Claude", "ChatGPT", "Claude Code", "Codex", "Cursor", "Gemini CLI", "VS Code with Copilot", "the OpenAI API"];

const FAQ: [string, string][] = [
  ["What does it cost?", "Nothing. EasyEdit is free."],
  [
    "Do I need to install anything?",
    "No. EasyEdit runs in your web browser. Sign in with a Google account and your first project is a click away.",
  ],
  [
    "Which AI agents can I use?",
    `${AGENTS.slice(0, -1).join(", ")} and ${AGENTS.at(-1)}, plus any other agent that speaks MCP. You can connect as many as you like.`,
  ],
  [
    "What can an agent do?",
    "Anything you can do on the timeline: add text and media, trim, split and move clips, change the format, add guides. It can start new projects too.",
  ],
  [
    "Can an agent mess up my project?",
    "Each agent acts as you, and its changes are labelled with its name in Activity. Undo any one of them like any other change.",
  ],
  [
    "Where do my videos go?",
    "Into Google Drive. Each space connects one Google account, and media you upload goes to a folder in that Drive. You keep ownership of everything you make.",
  ],
  [
    "Does export upload my video?",
    "No. The MP4 is rendered in your browser and saved to your computer.",
  ],
  [
    "Can I use it on my own?",
    "Yes. Everyone gets a Personal space. Make a team space when you want to edit with other people.",
  ],
  [
    "How do I bring my team in?",
    "Create a team, then invite people by email from Members. Admins manage the space; editors edit.",
  ],
  [
    "Is there a guide?",
    "A three-minute tutorial opens the first time you sign in, and stays on the Learn page afterwards.",
  ],
];

// closedBeta: sign-up isn't open (openSignUp() in signup.ts, read on the server), so only invited people get in.
export function HomePage({ closedBeta = false }: { closedBeta?: boolean }) {
  return (
    <main className={`${erode.variable} ${styles.page}`}>
      {/* First screen: the card on one side, the editor playing on the other. */}
      <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.card}>
          <CutBand />
          <div className={styles.cardBody}>
            <p className={styles.wordmark}>
              <LogoMark size={44} />
              <span>EasyEdit</span>
            </p>
            <h1 id="home-title" className={styles.heroTitle}>
              Edit videos with your team and AI
            </h1>
            <p className={styles.heroLead}>
              A free video editor in your browser. Teammates work in the same project at once, and AI agents like Claude
              and ChatGPT make edits when you ask in plain words.
            </p>
            <Link href="/login" className={styles.button}>
              {closedBeta ? "Sign in" : "Start editing, free"}
            </Link>
            {closedBeta && <p className={styles.heroNote}>EasyEdit is in closed beta. Sign-in is by invitation only for now.</p>}
            <nav className={styles.heroLinks} aria-label="On this page">
              <a href="#ai">AI agents</a>
              <a href="#team">Teams</a>
              <a href="#tools">The editor</a>
              <Link href="/login">Sign in</Link>
            </nav>
          </div>
        </div>
        <Stage clips={[CLIPS.ai, CLIPS.team, CLIPS.edit, CLIPS.export]} mode="cycle" className={styles.heroStage} />
      </section>

      {/* The live thing, full width. */}
      <section id="ai" className={styles.ai} aria-labelledby="ai-title">
        <div className={styles.aiHead}>
          <h2 id="ai-title" className={styles.sectionTitle}>
            Ask an agent to edit
          </h2>
          <p className={styles.aiLead}>
            Connect Claude, ChatGPT, Cursor or any agent that speaks MCP. Then say what you want. The change lands in
            your project in front of you, signed with the agent&apos;s name.
          </p>
        </div>
        <AgentDemo />
      </section>

      {/* The second split: the editor playing on the left, the team and the tools on the right. */}
      <div className={styles.split}>
        <Stage clips={[CLIPS.team, CLIPS.edit, CLIPS.export]} mode="follow" className={styles.splitStage} />
        <div className={styles.column}>
          <section id="team" data-stage="team" className={styles.team} aria-labelledby="team-title">
            <h2 id="team-title" className={styles.sectionTitle}>
              Your whole team, one project
            </h2>
            <p className={styles.columnLead}>
              Make a team space, invite people, and everyone edits the same project at the same time. Nobody waits for
              a file.
            </p>
            {TEAM.map((m) => (
              <article key={m.title} className={styles.module}>
                <div className={styles.modulePanel}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a fixed crop of a recording, served as is */}
                  <img src={m.img} alt={m.alt} width={m.w} height={m.h} loading="lazy" />
                </div>
                <h3 className={styles.moduleTitle}>{m.title}</h3>
                {m.body.map((p) => (
                  <p key={p} className={styles.moduleText}>
                    {p}
                  </p>
                ))}
              </article>
            ))}
          </section>

          <section id="tools" data-stage="edit" className={styles.tools} aria-labelledby="tools-title">
            <h2 id="tools-title" className={styles.giant}>
              Tools
            </h2>
            <p className={styles.columnLead}>
              A real timeline with tracks, a tool rail and a keyboard for everything. Open a group to see what&apos;s in it.
            </p>
            <div className={styles.bars}>
              {TOOLS.map((group, i) => (
                <details key={group.name} className={styles.bar} open={i === 0}>
                  <summary>{group.name}</summary>
                  <dl>
                    {group.rows.map(([what, how]) => (
                      <div key={what}>
                        <dt>{what}</dt>
                        <dd>{how}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))}
            </div>
          </section>

          <section data-stage="export" className={styles.export} aria-labelledby="export-title">
            <h2 id="export-title" className={styles.sectionTitle}>
              Export in your browser
            </h2>
            <p className={styles.exportFigure}>MP4</p>
            <p className={styles.columnLead}>
              Click Export and the video renders on your own computer, frame by frame, into an MP4 ready for TikTok,
              Reels, Shorts or YouTube. Nothing is uploaded, and there&apos;s no queue to wait in.
            </p>
          </section>
        </div>
      </div>

      <section className={styles.faq} aria-labelledby="faq-title">
        <h2 id="faq-title" className={styles.sectionTitle}>
          Questions, answered
        </h2>
        <div className={styles.faqText}>
          {FAQ.map(([q, a]) => (
            <p key={q}>
              <strong>{q}</strong> {a}
            </p>
          ))}
        </div>
      </section>

      <section className={styles.cta} aria-labelledby="cta-title">
        <div className={styles.ctaWords}>
          <h2 id="cta-title" className={styles.ctaTitle}>
            Make the first cut.
          </h2>
          <p>Sign in with Google and your first project opens in the editor.</p>
        </div>
        <NewProjectDialog />
      </section>

      <footer className={styles.footer}>
        <CutBand tracks={1} className={styles.footerBand} />
        <div className={styles.footerLine}>
          <span>A video editor for teams and AI agents</span>
          <nav aria-label="Footer">
            <Link href="/login">Sign in</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
          <span>© 2026 EasyEdit</span>
        </div>
      </footer>
    </main>
  );
}

// The editor's own New project dialog, shown open as the last thing on the page. It is a picture of the first step,
// not a form: its button takes you to sign in, where the real one waits.
function NewProjectDialog() {
  return (
    <div data-ui className={styles.dialog}>
      <p className={styles.dialogTitle}>New project</p>
      <p className={styles.dialogLabel}>Name</p>
      <p className={styles.dialogField}>Spring showcase</p>
      <p className={styles.dialogLabel}>Format</p>
      <div className={styles.dialogFormats}>
        <span data-on>
          <span className={styles.dialogShape} data-shape="tall" />
          Vertical 9:16
        </span>
        <span>
          <span className={styles.dialogShape} data-shape="wide" />
          Landscape 16:9
        </span>
      </div>
      <Link href="/login" className={styles.dialogButton}>
        Sign in to create it
      </Link>
    </div>
  );
}
