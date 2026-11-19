"use client";

import { useState } from "react";

export type MarqueeAgent = { name: string; logo: string };

// The row of agent logos under "Works with every AI agent." It scrolls for as long as the page is open, so it has a
// Pause button of its own (the hero's only holds the hero), and it holds still while the pointer is over it. The
// button comes first, at the row's leading edge on the page's left margin, so it is met before what it holds and
// stays with the row wherever the row is. The row is a list of the agents' names, and a second, hidden copy follows
// it so the loop has no seam. With reduced motion asked for it never moves: home.css wraps the list and hides the
// copy and the button. The button's words change between Pause and Play, so it is not also marked pressed: a screen
// reader would then say "Play, pressed", which tells neither whether the logos are moving nor what a press does.
export function AgentMarquee({ agents }: { agents: MarqueeAgent[] }) {
  const [paused, setPaused] = useState(false);
  const row = (copy: boolean) => (
    <ul className="h-marqueeList" aria-label={copy ? undefined : "AI agents"} aria-hidden={copy || undefined}>
      {agents.map((a) => (
        <li key={a.name} className="h-agent">
          {/* The marks: monochrome icons from LobeHub's icon set (MIT), drawn in the text's colour. */}
          <span className="h-agentLogo" style={{ maskImage: `url(/home/logos/${a.logo}.svg)` }} />
          {a.name}
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <button type="button" className="h-pause h-marqueePause" onClick={() => setPaused((p) => !p)}>
        {paused ? "Play" : "Pause"}
        {/* Two Pause buttons on one page: the hidden words say which one this is. */}
        <span className="h-sr"> the agent logos</span>
      </button>
      <div className="h-marquee">
        <div className="h-marqueeTrack" data-paused={paused || undefined}>
          {row(false)}
          {row(true)}
        </div>
      </div>
    </>
  );
}
