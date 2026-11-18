import { LogoMark } from "@/components/ui/logo";

// Two small drawn pieces of the app for the team cards, in its own colours and wording, with Pexels stills
// (free to use) as the footage: the editor with teammates' selections, and a team space's All projects page.

export function PresenceShot() {
  return (
    <div className="h-shot" data-ui aria-hidden="true">
      <div className="h-shotBar">
        <span className="h-shotName">City nights</span>
        <span className="h-shotAvatars">
          <span style={{ background: "var(--ed-peer-1)" }}>SO</span>
          <span style={{ background: "var(--ed-peer-2)" }}>MK</span>
        </span>
        <span className="h-shotMuted">Saved</span>
      </div>
      <div className="h-shotPreview">
        {/* eslint-disable-next-line @next/next/no-img-element -- footage inside a drawn interface */}
        <img src="/home/still-street.webp" alt="" width={960} height={540} />
        <span className="h-shotSel" style={{ inset: "8% 46% 30% 6%", "--peer": "var(--ed-peer-1)" } as React.CSSProperties}>
          <span>Sam</span>
        </span>
        <span className="h-shotSel h-shotSelText" style={{ inset: "62% 8% 12% 50%", "--peer": "var(--ed-peer-2)" } as React.CSSProperties}>
          <span>Mika</span>
          Night shift
        </span>
      </div>
    </div>
  );
}

const PROJECTS = [
  { name: "Summer reel", img: "/home/still-dog.webp", meta: "Vertical 9:16", by: "Changed 2 hours ago by Sam Okafor" },
  { name: "City nights", img: "/home/still-street.webp", meta: "Landscape 16:9", by: "Changed yesterday by you" },
  { name: "Into the hills", img: "/home/still-misty.webp", meta: "Feed 4:5", by: "Changed 3 days ago by Mika Kato" },
  { name: "Surf day", img: "/home/still-surf.webp", meta: "Square 1:1", by: "Changed last week by you" },
];

export function ProjectsShot() {
  return (
    <div className="h-shot" data-ui aria-hidden="true">
      <div className="h-shotBar">
        <span className="h-shotName">All projects</span>
        <span className="h-shotNew">+ New project</span>
      </div>
      <div className="h-shotBody">
        <p className="h-shotMuted">Folders</p>
        <div className="h-shotFolders">
          <span>Travel · 2</span>
          <span>Interviews · 1</span>
        </div>
        <p className="h-shotMuted">Projects</p>
        <div className="h-shotGrid">
          {PROJECTS.map((p) => (
            <span key={p.name} className="h-shotCard">
              {/* eslint-disable-next-line @next/next/no-img-element -- a project thumbnail in a drawn interface */}
              <img src={p.img} alt="" width={320} height={180} />
              <span className="h-shotCardName">{p.name}</span>
              <span className="h-shotMuted">{p.meta}</span>
              <span className="h-shotMuted">{p.by}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Storage, as the app shows it: the dashboard window of a team, open on its Storage settings (wording from
// lib/storage/messages.ts and the settings tabs), with the editor dimmed behind it, so it reads as the app itself.
export function DriveShot() {
  return (
    <div className="h-driveStage" aria-hidden="true">
      <div className="h-shot h-driveBack" data-ui>
        <div className="h-shotBar">
          <span className="h-shotName">Summer reel</span>
          <span className="h-shotMuted" style={{ marginLeft: "auto" }}>
            Saved
          </span>
          <span className="h-shotNew">Export</span>
        </div>
        <div className="h-shotPreview">
          {/* eslint-disable-next-line @next/next/no-img-element -- footage inside a drawn interface */}
          <img src="/home/still-dog.webp" alt="" width={960} height={540} />
        </div>
      </div>

      <div className="h-shot h-driveWin" data-ui>
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
              <p>Stored in maya.lin@gmail.com&apos;s Google Drive</p>
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
