import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/ui/logo";
import { AgentDemo } from "./agent-demo";
import { AgentMarquee } from "./agent-marquee";
import { HeroScene } from "./hero-scene";
import { NewProjectForm } from "./new-project-form";
import { DriveShot, PresenceShot, ProjectsShot } from "./team-shots";
import "./home.css";

// The public home page, for anyone who lands on easyedit.arush.dev signed out. Always dark, in the app's own type.
// The footage in public/home is from Pexels (free to use, no credit required); activity.webp and brand-kit.webp are
// crops of the real editor from the intro tutorial's recording.

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

const TEAM: { shot: ReactNode; title: string; text: string }[] = [
  {
    shot: <PresenceShot />,
    title: "See who's here",
    text: "Everyone in a project shows in the editor, and a teammate's selection shows in their colour with their name on it. Their changes reach you in seconds.",
  },
  {
    shot: (
      // eslint-disable-next-line @next/next/no-img-element -- a fixed crop of the real editor, served as is
      <img
        src="/home/activity.webp"
        alt="The Activity list: Sam Okafor added a video clip, and you added 3 clips, each with Undo this change."
        width={540}
        height={370}
        loading="lazy"
      />
    ),
    title: "Undo anyone's change",
    text: "Activity lists every change and who made it: you, a teammate or an AI agent. Undo any one of them from the list.",
  },
  {
    shot: <ProjectsShot />,
    title: "A space for each team",
    text: "A team space holds its projects, folders and media. Invite people by email, pin projects for everyone, and keep a Personal space for yourself.",
  },
  {
    shot: (
      // eslint-disable-next-line @next/next/no-img-element -- a fixed crop of the real editor, served as is
      <img
        src="/home/brand-kit.webp"
        alt="A team's brand kit: Orbitron for titles, Inter for subtitles and body text, and four brand colours."
        width={1180}
        height={820}
        loading="lazy"
      />
    ),
    title: "One brand kit",
    text: "Set the team's fonts, colours and logos once. New titles start in the team's fonts, and the kit is a tab away in the editor.",
  },
];

const AGENTS = ["Claude", "ChatGPT", "Claude Code", "Codex", "Cursor", "Gemini CLI", "VS Code Copilot", "OpenAI API"];

// The marquee's marks: monochrome icons from LobeHub's icon set (MIT), tinted by CSS.
const AGENT_LOGOS: { name: string; logo: string }[] = [
  { name: "Claude", logo: "claude" },
  { name: "ChatGPT", logo: "openai" },
  { name: "Claude Code", logo: "claudecode" },
  { name: "Codex", logo: "codex" },
  { name: "Cursor", logo: "cursor" },
  { name: "Gemini CLI", logo: "geminicli" },
  { name: "VS Code Copilot", logo: "githubcopilot" },
  { name: "OpenAI API", logo: "openai" },
];

// closedBeta: sign-up isn't open (openSignUp() in signup.ts, read on the server), so only invited people get in.
export function HomePage({ closedBeta = false }: { closedBeta?: boolean }) {
  return (
    <main className="h-page ed-theme">
      <HeroScene closedBeta={closedBeta} />

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
        <div className="h-statement h-agents">
          <h2 className="h-giant">Works with every AI agent.</h2>
          <p className="h-lead">
            {AGENTS.join(", ")} and anything else that speaks MCP. Connect one from AI agents in your account menu.
          </p>
        </div>
        <AgentMarquee>
          {[...AGENT_LOGOS, ...AGENT_LOGOS].map((a, i) => (
            <span key={`${a.name}-${i}`} className="h-agent">
              <span className="h-agentLogo" style={{ maskImage: `url(/home/logos/${a.logo}.svg)` }} />
              {a.name}
            </span>
          ))}
        </AgentMarquee>
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
              <div className="h-teamShot">{m.shot}</div>
              <h3>{m.title}</h3>
              <p>{m.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="h-section h-drive" aria-labelledby="drive-title">
        <div className="h-sectionHead">
          <h2 id="drive-title" className="h-h2">
            <span className="h-line">Completely free.</span> <span className="h-line">Based in your Drive.</span>
          </h2>
          <p className="h-lead">
            EasyEdit costs nothing. Connect a Google account, and your videos, images and audio live in a folder EasyEdit
            makes in that Drive. They stay yours, and EasyEdit can&apos;t see your other files.
          </p>
        </div>
        <DriveShot />
      </section>

      <section id="start" className="h-section h-start" aria-labelledby="start-title">
        <div className="h-sectionHead">
          <h2 id="start-title" className="h-wide">
            Make your first project.
          </h2>
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
