import Link from "next/link";
import { LogoMark } from "@/components/ui/logo";
import { AgentDemo } from "./agent-demo";
import { HeroReel, type Slide } from "./hero-reel";
import { NewProjectForm } from "./new-project-form";
import "./home.css";

// The public home page, for anyone who lands on easyedit.arush.dev signed out. Always dark, in the app's own type.
// Its recordings and stills are cut from the intro tutorial's recording of the real editor (public/home); the sample
// footage inside them is from Pexels (no credit required).

const SLIDES: Slide[] = [
  {
    key: "ai",
    src: "/home/stage-ai.mp4",
    poster: "/home/stage-ai.jpg",
    phrase: "for AI agents.",
    tab: "AI agents",
    line: "Ask Claude, ChatGPT or Cursor in plain words, and watch the edit land in your project.",
    label: "A recording of the EasyEdit editor: asked for a subtitle, an AI agent adds it, and the change appears in Activity.",
  },
  {
    key: "team",
    src: "/home/stage-team.mp4",
    poster: "/home/stage-team.jpg",
    phrase: "for teams.",
    tab: "Teams",
    line: "Everyone edits the same project at once, and sees who's working on what.",
    label: "A recording of the EasyEdit editor: a teammate's selection shows in pink while they add a clip.",
  },
  {
    key: "edit",
    src: "/home/stage-edit.mp4",
    poster: "/home/stage-edit.jpg",
    phrase: "for short videos.",
    tab: "Short videos",
    line: "Reels, Shorts and TikToks on a real timeline, saved as you go.",
    label: "A recording of the EasyEdit editor: a title is typed on the preview and its font and colour are changed.",
  },
  {
    key: "export",
    src: "/home/stage-export.mp4",
    poster: "/home/stage-export.jpg",
    phrase: "in your browser.",
    tab: "In your browser",
    line: "Nothing to install. Your video renders to an MP4 right on your computer.",
    label: "A recording of the EasyEdit export dialog rendering a video and saying it is ready.",
  },
];

const AI_POINTS = [
  {
    title: "Plain words in, real edits out",
    text: "Agents add text and media, trim, split and move clips, change the format and add guides. They can start new projects too.",
  },
  {
    title: "Signed and undoable",
    text: "Every change an agent makes shows in Activity with its name on it. Undo it like any other change.",
  },
  {
    title: "It works as you",
    text: "Each agent acts as you, in the space you choose. Connect as many as you like.",
  },
];

const TEAM = [
  {
    img: "/home/presence.jpg",
    w: 820,
    h: 420,
    alt: "The editor with a pink frame and the name Sam on the clip a teammate has selected.",
    title: "See who's here",
    text: "Everyone in a project shows in the editor, and a teammate's selection shows in their colour with their name on it. Their changes reach you in seconds.",
  },
  {
    img: "/home/activity.jpg",
    w: 540,
    h: 370,
    alt: "The Activity list: Sam Okafor added a video clip, and you added 3 clips, each with Undo this change.",
    title: "Undo anyone's change",
    text: "Activity lists every change and who made it: you, a teammate or an AI agent. Undo any one of them from the list.",
  },
  {
    img: "/home/projects.jpg",
    w: 1580,
    h: 760,
    alt: "All projects in a team space, with the folders Competition season and Outreach above four project cards.",
    title: "A space for each team",
    text: "A team space holds its projects, folders and media. Invite people by email, pin projects for everyone, and keep a Personal space for yourself.",
  },
  {
    img: "/home/brand-kit.jpg",
    w: 1180,
    h: 820,
    alt: "A team's brand kit: Orbitron for titles, Inter for subtitles and body text, and four brand colours.",
    title: "One brand kit",
    text: "Set the team's fonts, colours and logos once. New titles start in the team's fonts, and the kit is a tab away in the editor.",
  },
];

const AGENTS = ["Claude", "ChatGPT", "Claude Code", "Codex", "Cursor", "Gemini CLI", "VS Code Copilot", "OpenAI API"];

const MORE = [
  { title: "Your files stay yours", text: "Media goes into the Google Drive your space connects. You keep ownership of everything you make." },
  { title: "Saved as you go", text: "There's no save button. Every change is kept, and Activity remembers each one." },
  { title: "Nothing uploads on export", text: "The MP4 is rendered in your browser, frame by frame, and saved to your computer." },
];

// closedBeta: sign-up isn't open (openSignUp() in signup.ts, read on the server), so only invited people get in.
export function HomePage({ closedBeta = false }: { closedBeta?: boolean }) {
  return (
    <main className="h-page ed-theme">
      <HeroReel slides={SLIDES} closedBeta={closedBeta} />

      <section id="ai" className="h-section" aria-labelledby="ai-title">
        <div className="h-sectionHead">
          <h2 id="ai-title" className="h-h2">
            Ask an agent. Watch it edit.
          </h2>
          <p className="h-lead">
            Connect Claude, ChatGPT, Cursor or any agent that speaks MCP. Say what you want, and the change lands in your
            project, signed with the agent&apos;s name.
          </p>
        </div>
        <AgentDemo />
        <ul className="h-points">
          {AI_POINTS.map((p) => (
            <li key={p.title}>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="teams" className="h-section" aria-labelledby="teams-title">
        <div className="h-sectionHead">
          <h2 id="teams-title" className="h-h2">
            Built for teams.
          </h2>
          <p className="h-lead">
            Make a team space, invite people by email, and everyone edits the same project at the same time. Nobody
            waits for a file.
          </p>
        </div>
        <div className="h-teamGrid">
          {TEAM.map((m) => (
            <article key={m.title} className="h-teamCard">
              <div className="h-teamShot">
                {/* eslint-disable-next-line @next/next/no-img-element -- a fixed crop of a recording, served as is */}
                <img src={m.img} alt={m.alt} width={m.w} height={m.h} loading="lazy" />
              </div>
              <h3>{m.title}</h3>
              <p>{m.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="h-statements" aria-label="Free, and works with every AI agent">
        <div className="h-statement">
          <h2 className="h-giant">Completely free.</h2>
          <p className="h-lead">Every feature, for everyone. No plans to pick, no trial, no card.</p>
        </div>
        <div className="h-statement">
          <h2 className="h-giant">Works with every AI agent.</h2>
          <p className="h-lead">
            {AGENTS.join(", ")} and anything else that speaks MCP. Connect one from AI agents in your account menu.
          </p>
        </div>
        <div className="h-marquee" aria-hidden="true">
          <div className="h-marqueeTrack">
            {[...AGENTS, ...AGENTS].map((a, i) => (
              <span key={`${a}-${i}`}>{a}</span>
            ))}
          </div>
        </div>
        <ul className="h-more">
          {MORE.map((m) => (
            <li key={m.title}>
              <h3>{m.title}</h3>
              <p>{m.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="start" className="h-section h-start" aria-labelledby="start-title">
        <div className="h-sectionHead">
          <h2 id="start-title" className="h-h2">
            Make your first project.
          </h2>
          <p className="h-lead">Name it, pick where you&apos;ll post it, and you&apos;re in the editor.</p>
        </div>
        <NewProjectForm />
      </section>

      <footer className="h-footer">
        <span className="h-brand">
          <LogoMark size={20} />
          <span>EasyEdit</span>
        </span>
        <nav aria-label="Footer">
          <Link href="/login">Sign in</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
        <span className="h-footerNote">© 2026 EasyEdit</span>
      </footer>
    </main>
  );
}
