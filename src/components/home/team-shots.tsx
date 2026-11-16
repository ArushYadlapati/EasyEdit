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
        <img src="/home/still-street.jpg" alt="" width={960} height={540} />
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
  { name: "Summer reel", img: "/home/still-dog.jpg", meta: "Vertical 9:16", by: "Changed 2 hours ago by Sam Okafor" },
  { name: "City nights", img: "/home/still-street.jpg", meta: "Landscape 16:9", by: "Changed yesterday by you" },
  { name: "Into the hills", img: "/home/still-misty.jpg", meta: "Feed 4:5", by: "Changed 3 days ago by Mika Kato" },
  { name: "Surf day", img: "/home/still-surf.jpg", meta: "Square 1:1", by: "Changed last week by you" },
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
