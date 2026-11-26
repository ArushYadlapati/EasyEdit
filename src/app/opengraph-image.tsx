import { ImageResponse } from "next/og";

// The picture a shared link to EasyEdit shows (Discord, iMessage, Slack): the home page's first screen in brief, on its
// black. The logo and name, the headline with its ending as Claude's text clip (Claude's orange box and name tag, the
// page's one colour, which is always an author's), and the lead's promise under it. Made once, at build time.

export const alt = "EasyEdit: the video editor for AI agents. Free, and your videos stay in your own Google Drive.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The site's own colours (components/site/site.css) and the logo's three blues on a dark page (globals.css).
const BLACK = "#000";
const TEXT = "#fafafa";
const MUTED = "#a1a1aa";
const CLAUDE = "#f97316";
const LOGO = ["#b8d4ff", "#6ea8ff", "#2f6fdb"];
// The mark's full drawing, as components/ui/logo.tsx draws it.
const LOGO_SHAPES = [
  "M0 0L129.9 75L0 150Z",
  "M46 0L175.9 75L46 150L46 136.14L151.9 75L46 13.86Z",
  "M92 0L221.9 75L92 150L92 136.14L197.9 75L92 13.86Z",
];

// Geist at the two weights the picture uses, from Google Fonts. Without them (no network at build) it is drawn in the
// Geist that Next's image renderer carries, at its one weight.
async function geist(weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Geist:wght@${weight}`)).text();
    const url = /src: url\((.+?)\) format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
    if (!url) return null;
    const font = await fetch(url);
    return font.ok ? await font.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function OpenGraphImage() {
  const [regular, semibold] = await Promise.all([geist(400), geist(600)]);
  const fonts =
    regular && semibold
      ? [
          { name: "Geist", data: regular, weight: 400 as const, style: "normal" as const },
          { name: "Geist", data: semibold, weight: 600 as const, style: "normal" as const },
        ]
      : undefined;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 80px 72px",
          background: BLACK,
          color: TEXT,
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width={53} height={36} viewBox="0 0 221.9 150">
            {LOGO_SHAPES.map((d, i) => (
              <path key={d} d={d} fill={LOGO[i]} />
            ))}
          </svg>
          <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: "-0.02em" }}>EasyEdit</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 112, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.05 }}>The video editor</span>
          <div style={{ display: "flex", marginTop: 8 }}>
            <div style={{ display: "flex", position: "relative", padding: "0 12px", marginLeft: -12, border: `3px solid ${CLAUDE}` }}>
              <span style={{ fontSize: 112, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.05 }}>for AI agents.</span>
              {/* The selection's four handles: white, edged in its author's colour, on its corners. */}
              {[
                { left: -9, top: -9 },
                { right: -9, top: -9 },
                { left: -9, bottom: -9 },
                { right: -9, bottom: -9 },
              ].map((at, i) => (
                <span
                  key={i}
                  style={{ position: "absolute", ...at, width: 15, height: 15, background: "#fff", border: `3px solid ${CLAUDE}` }}
                />
              ))}
              <span
                style={{
                  position: "absolute",
                  left: -3,
                  top: "100%",
                  marginTop: 9, // clear of the corner's handle
                  padding: "4px 12px",
                  background: CLAUDE,
                  color: "#0a0a0a",
                  fontSize: 24,
                  fontWeight: 600,
                  borderRadius: "0 4px 4px 4px",
                }}
              >
                Claude
              </span>
            </div>
          </div>
        </div>

        <span style={{ fontSize: 32, color: MUTED, letterSpacing: "-0.01em" }}>Free, and your videos stay in your own Google Drive.</span>
      </div>
    ),
    { ...size, fonts },
  );
}
