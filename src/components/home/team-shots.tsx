import type { CSSProperties } from "react";
import { LogoMark } from "@/components/ui/logo";

// Drawn pieces of the app for the home page's team and Drive sections, in its own colours and wording, with Pexels
// stills (free to use) as the footage. They are pictures: aria-hidden, with the section's own words saying what
// they show.

const peer = (colour: string) => ({ "--peer": colour }) as CSSProperties;
const SAM = peer("var(--ed-peer-1)");
const MIKA = peer("var(--ed-peer-2)");
const YOU = peer("var(--ed-accent)");

// The team's brand kit, as the editor's Brand kit tab lists it: a font for each kind of text, its colours and its logo.
const KIT_FONTS = [
  { role: "Title", family: "Bebas Neue" },
  { role: "Subtitle", family: "Montserrat" },
  { role: "Body text", family: "Inter" },
];
const KIT_COLOURS = ["#ff4d2e", "#ffc53d", "#ffffff", "#1f2a44"];

// The team's logo: a sun on the horizon, in the kit's amber.
function KitLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="15" fill="#ffc53d" />
      <rect x="0" y="18" width="32" height="3" fill="#0a0a0a" />
    </svg>
  );
}

// A selection drawn as the editor draws it: an edge in the person's colour, their name, and the corner handles.
function Selection({ who, style, className = "h-tmSel" }: { who: string; style: CSSProperties; className?: string }) {
  return (
    <span className={className} style={style}>
      <span className="h-edPeerTag">{who}</span>
      <span className="h-edHandle" data-at="tl" />
      <span className="h-edHandle" data-at="tr" />
      <span className="h-edHandle" data-at="bl" />
      <span className="h-edHandle" data-at="br" />
    </span>
  );
}

// Newest first, in the app's own Activity wording (summarizeOps in lib/editor/activity.ts): every row can be undone,
// whoever made it.
const ACTIVITY = [
  { who: "Sam Okafor", what: "Added text", when: "just now" },
  { who: "Mika Kato", what: "Changed a video clip: position and scale", when: "1 minute ago" },
  { who: "You", what: "Added an image", when: "4 minutes ago" },
  { who: "Claude (for Mika Kato)", what: "Split a video clip", when: "9 minutes ago" },
];

const RULER = ["0:00", "0:04", "0:08", "0:12", "0:16", "0:20"];

// One of the team's projects open in the editor with two teammates in it: the top bar's dots say who is here (you,
// Sam, Mika), each person's selection is drawn in their own colour with their name (Sam on the title, Mika on the
// video clip, you on the logo), and Activity lists their changes, each with Undo this change. The left panel is open
// on the team's brand kit, and what is in the picture comes from it: the title is set in its title font, and the logo
// is its logo.
export function TeamScene() {
  return (
    <div className="h-tm" data-ui aria-hidden="true">
      <div className="h-tmBar">
        <LogoMark size={16} />
        <span className="h-tmMenu">Projects</span>
        <span className="h-tmMenu">Edit</span>
        <span className="h-tmMenu">View</span>
        <span className="h-tmProject">City nights</span>
        <span className="h-tmPeople">
          <span className="h-tmMe" />
          <span className="h-tmDot" style={SAM}>
            SO
          </span>
          <span className="h-tmDot" style={MIKA}>
            MK
          </span>
        </span>
        <span className="h-tmStatus">2 people are editing…</span>
        <span className="h-tmExport">Export</span>
      </div>

      <div className="h-tmBody">
        <div className="h-tmKit">
          <div className="h-tmTabs">
            <span>Text</span>
            <span>Media</span>
            <span data-on>Brand kit</span>
          </div>
          <div className="h-kit">
            <p className="h-kitHead">Fonts</p>
            {KIT_FONTS.map((f) => (
              <p key={f.role} className="h-kitFont">
                <span className="h-kitRole">{f.role}</span>
                <span className="h-kitFamily">{f.family}</span>
              </p>
            ))}
            <p className="h-kitHead">Colors</p>
            <div className="h-kitSwatches">
              {KIT_COLOURS.map((c) => (
                <span key={c} className="h-kitSwatch" style={{ background: c }} />
              ))}
            </div>
            <p className="h-kitHead">Logos</p>
            <KitLogo className="h-kitLogo" />
          </div>
        </div>

        <div className="h-tmStage">
          <div className="h-tmFrame">
            {/* eslint-disable-next-line @next/next/no-img-element -- footage inside a drawn interface */}
            <img src="/home/still-street.webp" alt="" width={960} height={540} loading="lazy" decoding="async" />
            {/* Mika has the video clip selected, so the whole picture: her name sits inside its top corner. */}
            <span className="h-tmSel h-tmSelClip" style={MIKA}>
              <span className="h-edPeerTag">Mika</span>
            </span>
            <span className="h-tmTitle">
              <span>After dark</span>
              <Selection who="Sam" style={SAM} />
            </span>
            <span className="h-tmLogo">
              <KitLogo />
              <Selection who="You" style={YOU} />
            </span>
          </div>
        </div>

        <div className="h-tmSide">
          <div className="h-tmTabs">
            <span>Inspect</span>
            <span data-on>Activity</span>
            <span>Effects</span>
          </div>
          <ol className="h-tmActivity">
            {ACTIVITY.map((row) => (
              <li key={row.who}>
                <span>
                  {row.who} · {row.what}
                </span>
                <span className="h-tmWhen">
                  {row.when}
                  <span className="h-tmUndo">Undo this change</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="h-tmTimeline">
        <div className="h-tmRuler">
          {RULER.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <div className="h-tmTrack">
          <span className="h-tmTrackName">Text 1</span>
          <span className="h-tmLane">
            <span className="h-tmClip h-tmClipText" style={{ ...SAM, left: "6%", width: "24%" }} data-peer>
              After dark
              <span className="h-tmBadge">SO</span>
            </span>
          </span>
        </div>
        <div className="h-tmTrack">
          <span className="h-tmTrackName">Image 1</span>
          <span className="h-tmLane">
            <span className="h-tmClip h-tmClipImage" style={{ ...YOU, left: "0%", width: "100%" }} data-peer>
              <KitLogo className="h-tmClipLogo" />
              logo.png
            </span>
          </span>
        </div>
        <div className="h-tmTrack">
          <span className="h-tmTrackName">Video 1</span>
          <span className="h-tmLane">
            <span className="h-tmClip" style={{ ...MIKA, left: "0%", width: "42%" }} data-peer>
              {/* eslint-disable-next-line @next/next/no-img-element -- a clip's thumbnail in a drawn interface */}
              <img src="/home/still-street.webp" alt="" width={48} height={27} loading="lazy" decoding="async" />
              city-night.mp4
              <span className="h-tmBadge">MK</span>
            </span>
            <span className="h-tmClip" style={{ left: "42%", width: "58%" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a clip's thumbnail in a drawn interface */}
              <img src="/home/still-street.webp" alt="" width={48} height={27} loading="lazy" decoding="async" />
              city-night.mp4
            </span>
          </span>
        </div>
        <span className="h-tmPlayhead" />
      </div>
    </div>
  );
}

// Storage, as the app shows it: the dashboard window of a team, open on its Storage settings (wording from
// lib/storage/messages.ts and the settings tabs), with the editor dimmed behind it, so it reads as the app itself.
export function DriveShot() {
  return (
    <div className="h-driveStage" data-ui aria-hidden="true">
      <div className="h-shot h-driveBack">
        <div className="h-shotBar">
          <span className="h-shotName">Summer reel</span>
          <span className="h-shotMuted" style={{ marginLeft: "auto" }}>
            Saved
          </span>
          <span className="h-shotNew">Export</span>
        </div>
        <div className="h-shotPreview">
          {/* eslint-disable-next-line @next/next/no-img-element -- footage inside a drawn interface */}
          <img src="/home/still-dog.webp" alt="" width={960} height={540} loading="lazy" decoding="async" />
        </div>
      </div>

      <div className="h-shot h-driveWin">
        <div className="h-shotBar">
          <LogoMark size={16} />
          <span className="h-shotName">EasyEdit</span>
          <span className="h-shotMuted" style={{ marginLeft: "auto" }}>
            Maya Lin
          </span>
        </div>
        <div className="h-driveBody">
          <nav className="h-driveSide">
            <p className="h-driveHead">My Spaces</p>
            <p data-on>Summer crew</p>
            <p>Personal</p>
            <p className="h-driveHead">Projects</p>
            <p>Recent</p>
            <p>All projects</p>
            <p className="h-driveHead">This space</p>
            <p>Members</p>
            <p data-on>Storage</p>
          </nav>
          <div className="h-driveMain">
            <p className="h-shotMuted">Back to projects</p>
            <p className="h-shotTitle">Summer crew</p>
            <div className="h-driveTabs">
              <span>Members</span>
              <span data-on>Storage</span>
              <span>Brand kit</span>
            </div>
            <div className="h-driveCard">
              <p>Stored in maya@example.com&apos;s Google Drive</p>
              <p className="h-shotMuted">Folder &quot;EasyEdit – Summer crew&quot;</p>
              <p className="h-shotMuted">2.4 GB of 15 GB used</p>
              <span className="h-shotMeter">
                <span style={{ width: "16%" }} />
              </span>
              <p className="h-shotMuted">EasyEdit keeps the videos in a folder of its own there, and can&apos;t see your other files.</p>
              <div className="h-driveButtons">
                <span>Reconnect</span>
                <span>Use a different Google account</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
