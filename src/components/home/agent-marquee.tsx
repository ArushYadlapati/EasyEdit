"use client";

import { useState, type ReactNode } from "react";

// The row of agent logos under "Works with every AI agent." It scrolls for as long as the page is open, so it has a
// Pause button of its own (the hero's only holds the hero), and it holds still while the pointer is over it. The
// logos come in as children, drawn on the server. With reduced motion asked for it never moves, and home.css hides
// the button. Its words change between Pause and Play, so it is not also marked pressed: a screen reader would then
// say "Play, pressed", which tells neither whether the logos are moving nor what a press does.
export function AgentMarquee({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  return (
    <>
      <div className="h-marquee" aria-hidden="true">
        <div className="h-marqueeTrack" data-paused={paused || undefined}>
          {children}
        </div>
      </div>
      <button type="button" className="h-pause h-marqueePause" onClick={() => setPaused((p) => !p)}>
        {paused ? "Play" : "Pause"}
        {/* Two Pause buttons on one page: the hidden words say which one this is. */}
        <span className="h-sr"> the agent logos</span>
      </button>
    </>
  );
}
