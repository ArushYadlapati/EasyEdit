"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/ui/logo";

// The home page's one live thing: pick a request in plain words and watch a model of the editor change the way an
// agent's edit changes a real project. Each request is one of the connector's real tools (add_text, trim_clip,
// set_format, split_clip) and its Activity line is the app's own wording (summarizeOps in lib/editor/activity.ts).
// Once its edit lands, the line above the requests says what happened and what that shows about agents in EasyEdit.
//
// The pieces come in the order a phone shows them, one under the other: the heading and lead, the editor, the answer,
// then the requests. On a computer the editor moves to a column of its own beside the rest (home.css), so the
// keyboard goes from the editor's Undo to the requests at every width, top to bottom either way.
//
// Nothing changes size when a request is picked or when its edit lands, so the request under the pointer stays
// there and the editor holds still while you watch it: the requests are all the same few lines, the answer's space is
// the longest answer's, and the agent's Activity line keeps its place (unseen) while the agent works.

type Clip = { id: string; name: string; thumb: string; start: number; end: number };
type Doc = { vertical: boolean; title: boolean; video: Clip[] };

const SECONDS = 10; // the timeline's visible length
const PLAYHEAD = 3;

// Stills from Pexels footage (free to use, no credit required).
const DOG = { name: "beach-dog", thumb: "/home/still-dog.webp" };
const SURF = { name: "surf", thumb: "/home/still-surf.webp" };

const BASE: Doc = {
  vertical: false,
  title: false,
  video: [
    { id: "a", ...DOG, start: 0, end: 5 },
    { id: "b", ...SURF, start: 5, end: 9 },
  ],
};

type Request = {
  key: string;
  agent: string;
  words: string;
  summary: string;
  result: string;
  apply: (d: Doc) => Doc;
  fresh: string;
};

export const REQUESTS: Request[] = [
  {
    key: "title",
    agent: "Claude",
    words: "Add a title that says Summer trip.",
    summary: "Added text",
    result: "Claude adds the text clip. It shows in Activity with Claude's name on it, and Undo takes it back.",
    apply: (d) => ({ ...d, title: true }),
    fresh: "text",
  },
  {
    key: "trim",
    agent: "ChatGPT",
    words: "Make the surf shot two seconds long.",
    summary: "Trimmed a video clip",
    result: "ChatGPT trims the surf clip on the timeline, the same edit you'd make by hand.",
    apply: (d) => ({ ...d, video: d.video.map((c) => (c.id === "b" ? { ...c, end: 7 } : c)) }),
    fresh: "b",
  },
  {
    key: "vertical",
    agent: "Codex",
    words: "Make it vertical for Reels and TikTok.",
    summary: "Changed the format to Vertical 9:16",
    result: "Codex changes the format for you. Each agent acts as you, in the space you choose.",
    apply: (d) => ({ ...d, vertical: true }),
    fresh: "frame",
  },
  {
    key: "split",
    agent: "Cursor",
    words: "Split the beach clip at the playhead.",
    summary: "Split a video clip",
    result: "Cursor splits the beach clip in two. Connect as many agents as you like.",
    apply: (d) => ({
      ...d,
      video: d.video.flatMap((c) =>
        c.id === "a" ? [{ ...c, id: "a1", end: PLAYHEAD }, { ...c, id: "a2", start: PLAYHEAD }] : [c],
      ),
    }),
    fresh: "a2",
  },
];

type Phase = "working" | "done" | "undone";
const at = (s: number) => `${(s / SECONDS) * 100}%`;
const time = (s: number) => `0:${String(Math.floor(s)).padStart(2, "0")}`;

// children: the section's heading and lead, which come first.
export function AgentDemo({ children }: { children?: ReactNode }) {
  const [chosen, setChosen] = useState(0);
  const [phase, setPhase] = useState<Phase>("done");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const choose = (i: number) => {
    window.clearTimeout(timer.current);
    setChosen(i);
    setPhase("working");
    timer.current = window.setTimeout(() => setPhase("done"), 900);
  };

  const request = REQUESTS[chosen];
  const doc = phase === "done" ? request.apply(BASE) : BASE;
  const fresh = phase === "done" ? request.fresh : null;
  const shown = doc.video.find((c) => c.start <= PLAYHEAD && PLAYHEAD < c.end) ?? doc.video[0];

  return (
    <div className="h-demo">
      {children}

      <figure className="h-demoStage" aria-label="A working model of the editor">
        <div data-ui className="h-ui" data-agent={phase === "done" ? request.agent : undefined}>
          <div className="h-uiBar">
            <LogoMark size={16} />
            <span className="h-uiProject">Summer trip</span>
            {/* Both states in one spot, the one not in use unseen, so the status keeps its width when the edit lands. */}
            <span className="h-uiStatus">
              <span data-on={phase === "working" || undefined}>
                <span className="h-uiDot" /> {request.agent} is editing…
              </span>
              <span data-on={phase !== "working" || undefined}>Saved</span>
            </span>
            <span className="h-uiExport">Export</span>
          </div>

          <div className="h-uiMain">
            <div className="h-uiPreview">
              <div className="h-uiFrame" data-vertical={doc.vertical || undefined} data-fresh={fresh === "frame" || undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a fixed still inside a drawn interface */}
                <img src={shown.thumb} alt="" width={960} height={540} loading="lazy" decoding="async" />
                {doc.title && (
                  <span className="h-uiTitle">
                    <span className="h-uiTitleText">
                      Summer trip
                      {/* Claude's own selection on what it just made, in Claude's orange, as in the editor. */}
                      {fresh === "text" && (
                        <span className="h-edClaude h-uiClaude">
                          <span className="h-edPeerTag">Claude</span>
                          <span className="h-edHandle" data-at="tl" />
                          <span className="h-edHandle" data-at="tr" />
                          <span className="h-edHandle" data-at="bl" />
                          <span className="h-edHandle" data-at="br" />
                        </span>
                      )}
                    </span>
                  </span>
                )}
              </div>
            </div>

            <div className="h-uiSide">
              <div className="h-uiTabs">
                <span>Inspect</span>
                <span data-on>Activity</span>
              </div>
              <ol className="h-uiActivity">
                {/* Keyed by the request only, so the line (and the Undo button in it) stays the same element when the
                    change is undone, and the keyboard focus stays on the button. While the agent works the line is
                    already there with its words, unseen, so it arrives without pushing anything down. */}
                <li
                  key={request.key}
                  data-fresh
                  data-pending={phase === "working" || undefined}
                  aria-hidden={phase === "working" || undefined}
                >
                  <span className="h-uiWho">
                    {request.agent} (for you) · {request.summary}
                  </span>
                  <span className="h-uiWhen">
                    just now
                    {/* Once used it says Undone and does nothing more, but stays focusable: a disabled button would drop
                        the keyboard focus to the page, and "Undone" is then read where the focus is. */}
                    <button
                      type="button"
                      className="h-uiUndo"
                      aria-disabled={phase === "undone" || undefined}
                      onClick={() => {
                        if (phase === "done") setPhase("undone");
                      }}
                    >
                      {phase === "undone" ? "Undone" : "Undo this change"}
                    </button>
                  </span>
                </li>
                <li>
                  <span className="h-uiWho">You · Added 2 clips</span>
                  <span className="h-uiWhen">3 minutes ago</span>
                </li>
              </ol>
            </div>
          </div>

          <div className="h-uiTimeline">
            <div className="h-uiRuler">
              {Array.from({ length: SECONDS }, (_, s) => (
                <span key={s} style={{ left: at(s) }}>
                  {time(s)}
                </span>
              ))}
            </div>
            <div className="h-uiTrack">
              <span className="h-uiTrackName">Text 1</span>
              <div className="h-uiLane">
                {doc.title && (
                  <span
                    className="h-uiClip h-uiClipText"
                    style={{ left: at(0), width: at(4) }}
                    data-fresh={fresh === "text" || undefined}
                  >
                    Summer trip
                  </span>
                )}
              </div>
            </div>
            <div className="h-uiTrack">
              <span className="h-uiTrackName">Video 1</span>
              <div className="h-uiLane">
                {doc.video.map((c) => (
                  <span
                    key={c.id}
                    className="h-uiClip"
                    style={{ left: at(c.start), width: at(c.end - c.start) }}
                    data-fresh={fresh === c.id || undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a clip's thumbnail in a drawn interface */}
                    <img src={c.thumb} alt="" width={48} height={27} loading="lazy" decoding="async" />
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
            <span className="h-uiPlayhead" style={{ "--at": PLAYHEAD / SECONDS } as React.CSSProperties} />
          </div>
        </div>
      </figure>

      <div className="h-demoAnswer">
        {/* Every answer, unseen, in the one spot, so the space is the longest one's whichever is shown. */}
        {REQUESTS.map((r) => (
          <p key={r.key} className="h-demoSizer" aria-hidden="true">
            {r.result}
          </p>
        ))}
        {/* Always there, so a screen reader hears the answer when it fills in: once the agent's edit lands. */}
        <p className="h-demoResult" aria-live="polite">
          {phase === "working" ? "" : request.result}
        </p>
      </div>

      <ul className="h-demoRequests" aria-label="Ask an agent">
        {REQUESTS.map((r, i) => (
          <li key={r.key}>
            <button type="button" aria-pressed={i === chosen} onClick={() => choose(i)} className="h-demoRequest">
              <span className="h-demoWords">{r.words}</span>
              <span className="h-demoAgent">Ask {r.agent}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
