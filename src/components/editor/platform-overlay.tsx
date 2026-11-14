import type { ReactNode } from "react";
import { cropBox, type Box, type PlatformView } from "@/lib/editor/platform-views";

const pct = (n: number) => `${n * 100}%`;
const place = (b: Box) => ({ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) });

// Hatched red: hidden under the app.
const HATCH = "repeating-linear-gradient(135deg, rgba(255,70,70,.32) 0 4px, rgba(255,70,70,.12) 4px 8px)";

// A platform's view drawn over the frame: what it covers, plain stand-ins for its buttons and captions, and, for a
// feed or grid, a dimmed frame outside the part it shows. It sits inside the frame box, takes no clicks, and is
// never part of the picture, so editing and export are unchanged.
export function PlatformOverlay({ view, frameShape }: { view: PlatformView; frameShape: number }): ReactNode {
  const shown = view.crop === undefined ? null : cropBox(frameShape, view.crop);
  return (
    <div aria-hidden data-platform-view={view.id} className="pointer-events-none absolute inset-0 overflow-hidden">
      {view.covered.map((b, i) => (
        <div key={`c${i}`} className="absolute" style={{ ...place(b), backgroundImage: HATCH }} />
      ))}
      {view.marks.map((m, i) =>
        m.kind === "dot" ? (
          <div key={`m${i}`} className="absolute rounded-full bg-white/85" style={{ left: pct(m.x), top: pct(m.y), width: pct(m.w), aspectRatio: "1" }} />
        ) : (
          <div key={`m${i}`} className="absolute rounded-full bg-white/85" style={place(m)} />
        ),
      )}
      {shown && <div data-crop className="absolute" style={{ ...place(shown), outline: "9999px solid rgba(0, 0, 0, 0.6)" }} />}
      <span className="absolute top-1 left-1.5 rounded-[3px] bg-black/55 px-1 text-[11px] leading-4 text-white">{view.label}</span>
    </div>
  );
}
