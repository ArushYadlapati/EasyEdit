import Link from "next/link";
import { SitePage } from "@/components/site/site-page";
import { AgentDemo } from "./agent-demo";
import { AgentMarquee, type MarqueeAgent } from "./agent-marquee";
import { HeroScene } from "./hero-scene";
import { NewProjectForm } from "./new-project-form";
import { PageDock } from "./page-dock";
import { DriveShot, TeamScene } from "./team-shots";
import "./home.css";

// The public home page, for anyone who lands on easyedit.arush.dev signed out. Always dark, in the app's own type.
// The footage in public/home is from Pexels (free to use, no credit required); the pieces of the app in it are drawn.

// The agents in the marquee, each with its own mark (a file in public/home/logos).
const AGENTS: MarqueeAgent[] = [
  { name: "Claude", logo: "claude" },
  { name: "ChatGPT", logo: "openai" },
  { name: "Claude Code", logo: "claudecode" },
  { name: "Codex", logo: "codex" },
  { name: "Cursor", logo: "cursor" },
  { name: "Gemini CLI", logo: "geminicli" },
  { name: "VS Code Copilot", logo: "githubcopilot" },
];

// What free and in your Drive come to, one plain sentence each: no cost for anyone, the folder EasyEdit makes in the
// Drive a space connects (it asks only for the files it makes), and export on your own computer.
const FREE_FACTS = [
  "It costs nothing, teams included.",
  "It keeps them in a folder of its own.",
  "It can't see your other files.",
  "Exports render on your computer.",
];

// closedBeta: sign-up isn't open (openSignUp() in signup.ts, read on the server), so only invited people get in.
// The site's header and footer go around the page's <main>; the first screen starts under the header. Each section
// after it is a clip on the page's dock (page-dock.tsx), named by its data-dock-label, the close included, so the
// dock's playhead reaches the end of the last clip as the page ends. Every section heading is at the one h2 size; only
// the first screen's headline is larger.
export function HomePage({ closedBeta = false }: { closedBeta?: boolean }) {
  return (
    <SitePage>
      <main className="h-page ed-theme">
        <HeroScene closedBeta={closedBeta} />

        <section id="ai" className="h-section" aria-labelledby="ai-title" data-dock-label="Ask an agent">
          <AgentDemo>
            <h2 id="ai-title" className="h-h2">
              <span className="h-line">Ask an agent.</span> <span className="h-line">Watch it edit.</span>
            </h2>
            <p className="h-lead">
              Connect Claude, ChatGPT, Cursor or any agent that speaks MCP. Pick a request and watch it land in a working
              model of the editor.
            </p>
          </AgentDemo>
        </section>

        <section id="start" className="h-section h-start" aria-labelledby="start-title" data-dock-label="First project">
          <h2 id="start-title" className="h-h2 h-startTitle">
            Make your first project.
          </h2>
          <NewProjectForm />
        </section>

        {/* The heading, then what it comes to as a list a size under it (beside it on a computer), then the app's
            Storage page. */}
        <section id="free" className="h-section h-free" aria-labelledby="free-title" data-dock-label="Free">
          <h2 id="free-title" className="h-h2">
            <span className="h-line">Free, and your files</span> <span className="h-line">stay in your Drive.</span>
          </h2>
          <ul className="h-facts">
            {FREE_FACTS.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
          <DriveShot />
        </section>

        {/* One shared editor, large: the team's project with its people in it, and the team's brand kit open beside it. */}
        <section id="teams" className="h-section h-teams" aria-labelledby="teams-title" data-dock-label="Teams">
          <h2 id="teams-title" className="h-h2">
            Built for teams.
          </h2>
          <p className="h-lead">
            Everyone in a team space edits the same project at the same time. Each person&apos;s selection shows in their
            color with their name on it, and anyone can undo any change, a teammate&apos;s too. Nobody waits for a file.
          </p>
          <TeamScene />
        </section>

        <section id="agents" className="h-section h-agents" aria-labelledby="agents-title" data-dock-label="Every agent">
          <h2 id="agents-title" className="h-h2">
            <span className="h-line">Works with</span> <span className="h-line">every AI agent.</span>
          </h2>
          <p className="h-lead">
            Any agent that speaks MCP can edit your projects. Connect one from AI&nbsp;agents in your account menu.
          </p>
          <AgentMarquee agents={AGENTS} />
        </section>

        {/* The page's close, a beat of its own after the agents and the last clip on the page's dock: you and your agent
            on the same project, then the one action again. */}
        <section id="timeline" className="h-section h-close" aria-labelledby="close-title" data-dock-label="Start">
          <h2 id="close-title" className="h-h2">
            <span className="h-line">You and your agent</span> <span className="h-line">share one timeline.</span>
          </h2>
          <div className="h-closeActions">
            {closedBeta ? (
              <Link href="/login" className="h-btn">
                Sign in
              </Link>
            ) : (
              <>
                <Link href="/login" className="h-btn">
                  Start free
                </Link>
                <Link href="/login" className="h-closeLink">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </section>

        {/* After the sections, so the keyboard comes to it once it has been through the page. */}
        <PageDock />
      </main>
    </SitePage>
  );
}
