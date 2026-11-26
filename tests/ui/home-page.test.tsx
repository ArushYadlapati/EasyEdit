// @vitest-environment happy-dom
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { AgentDemo, REQUESTS } from "@/components/home/agent-demo";
import { NewProjectForm } from "@/components/home/new-project-form";
import { FIRST_PROJECT_KEY } from "@/lib/home/first-project";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import type { CurrentUser } from "@/lib/access-rules";
import { cssRules } from "../helpers/css-rules";
import { act, fireEvent, render, screen, within } from "../helpers/dom";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  useRouter: () => ({ push }),
}));
const { signedIn } = vi.hoisted(() => ({ signedIn: { user: null as CurrentUser | null } }));
vi.mock("@/lib/access", () => ({ getCurrentUser: vi.fn(async () => signedIn.user) }));

const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };

// A WebP file's pixel size, from its first chunk: lossy (VP8), lossless (VP8L) or extended (VP8X).
function webpSize(file: Buffer): { width: number; height: number } {
  const chunk = file.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return { width: file.readUInt16LE(26) & 0x3fff, height: file.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = file.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: file.readUIntLE(24, 3) + 1, height: file.readUIntLE(27, 3) + 1 };
  throw new Error(`not a WebP file (first chunk ${JSON.stringify(chunk)})`);
}

beforeEach(() => {
  signedIn.user = null;
});

// The hero's ending as drawn, and a way to step through its retyping (one keystroke per render).
const ending = () => document.querySelector(".h-heroClip")?.firstChild?.nodeValue;
function typeOut() {
  for (let i = 0; i < 100 && document.querySelector(".h-heroClip[data-typing]"); i++) {
    act(() => {
      vi.advanceTimersByTime(40);
    });
  }
}

describe("home page", () => {
  it("signed out shows the headline, the start buttons to /login, and links to /privacy and /terms", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    render(await Home());
    vi.unstubAllEnvs();
    expect(screen.getByRole("heading", { level: 1, name: "The video editor for AI agents." })).toBeTruthy();
    // One name for the one action, in the header, the first screen and the page's close.
    const starts = screen.getAllByRole("link", { name: "Start free" });
    expect(starts).toHaveLength(3);
    for (const a of starts) expect(a.getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("link", { name: "Start editing, free" })).toBeNull();
    for (const a of screen.getAllByRole("link", { name: "Sign in" })) expect(a.getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
  });

  it("changes the headline's ending every few seconds: for AI agents, for teams, for creators, in your browser", async () => {
    vi.useFakeTimers();
    render(await Home());
    expect(ending()).toBe("for AI agents.");
    for (const next of ["for teams.", "for creators.", "in your browser.", "for AI agents."]) {
      act(() => {
        vi.advanceTimersByTime(9000); // each scene lasts 4 to 8.5 seconds
      });
      typeOut();
      expect(ending()).toBe(next);
    }
    vi.useRealTimers();
  });

  it("names each ending's author on its selection: Claude, a teammate, then you", async () => {
    vi.useFakeTimers();
    render(await Home());
    const tag = () => document.querySelector(".h-heroTag")?.textContent;
    expect(tag()).toBe("Claude");
    for (const next of ["Sam", "You", "You", "Claude"]) {
      act(() => {
        vi.advanceTimersByTime(9000);
      });
      expect(tag()).toBe(next);
      typeOut();
    }
    vi.useRealTimers();
  });

  it("says in the first screen that agents edit, that it's free and that the videos stay in your Drive", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    render(await Home());
    vi.unstubAllEnvs();
    const hero = document.querySelector(".h-hero") as HTMLElement;
    const lead = hero.querySelector("p")?.textContent ?? "";
    expect(lead).toContain("Ask Claude, ChatGPT or Cursor in plain words");
    expect(lead).toContain("free");
    expect(lead).toContain("Google Drive");
    const inHero = within(hero);
    expect(inHero.getByRole("link", { name: "Start free" }).getAttribute("href")).toBe("/login");
    expect(inHero.getByRole("link", { name: "See it edit" }).getAttribute("href")).toBe("#ai");
    // The drawn editor is a picture for sighted visitors, under the words rather than behind them.
    const editor = hero.querySelector(".h-ed");
    expect(editor?.getAttribute("aria-hidden")).toBe("true");
    expect(editor?.hasAttribute("data-ui")).toBe(true);
    expect(hero.querySelector(".h-heroBand")?.compareDocumentPosition(editor!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(hero.querySelector(".h-heroScrim")).toBeNull();
  });

  it("shows the editor's own View as: YouTube Shorts overlay in the creators scene", async () => {
    vi.useFakeTimers();
    render(await Home());
    expect(document.querySelector('[data-platform-view="youtube-shorts"]')).toBeNull();
    for (let i = 0; i < 2; i++) {
      act(() => {
        vi.advanceTimersByTime(9000);
      });
    }
    expect(document.querySelector<HTMLElement>(".h-hero")?.dataset.scene).toBe("creators");
    expect(document.querySelector('[data-platform-view="youtube-shorts"]')).toBeTruthy();
    expect(document.querySelector(".h-edViewAs")?.textContent).toContain("YouTube Shorts");
    vi.useRealTimers();
  });

  it("holds the scene while paused, and its button then says Play", async () => {
    vi.useFakeTimers();
    render(await Home());
    const button = screen.getByRole("button", { name: "Pause" });
    // The words change with the state, so the button is a plain button, not a pressed toggle as well.
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Play" })).toBe(button);
    act(() => {
      vi.advanceTimersByTime(12000);
    });
    expect(ending()).toBe("for AI agents.");
    expect(document.querySelector<HTMLElement>(".h-hero")?.dataset.scene).toBe("ai");

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Pause" })).toBe(button);
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    vi.useRealTimers();
  });

  it("pauses the agent logos with their own button, and leaves the hero playing", async () => {
    render(await Home());
    const track = document.querySelector(".h-marqueeTrack")!;
    const button = screen.getByRole("button", { name: "Pause the agent logos" });
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    expect(track.hasAttribute("data-paused")).toBe(false);

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Play the agent logos" })).toBe(button);
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    expect(track.hasAttribute("data-paused")).toBe(true);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy(); // the hero's, untouched

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Pause the agent logos" })).toBe(button);
    expect(track.hasAttribute("data-paused")).toBe(false);
    expect(track.querySelectorAll(".h-agent")).toHaveLength(14); // the row twice, so the loop has no seam
  });

  it("has the AI, free and team sections, linked from the site's header, and no tools section", async () => {
    render(await Home());
    const header = screen.getByRole("banner");
    const links = [...header.querySelectorAll("nav a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["AI agents", "/#ai"],
      ["Free", "/#free"],
      ["Teams", "/#teams"],
    ]);
    for (const id of ["ai", "free", "teams"]) expect(document.querySelector(`main #${id}`), id).toBeTruthy();
    expect(document.getElementById("free")?.textContent).toContain("stay in your Drive.");
    expect(document.getElementById("tools")).toBeNull();
  });

  it("puts the site's header and footer around its main, outside it", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    const { container } = render(await Home());
    vi.unstubAllEnvs();
    const [header, main, footer] = [...container.firstElementChild!.children];
    expect(container.firstElementChild?.className).toBe("h-site");
    expect([header.tagName, main.tagName, footer.tagName]).toEqual(["HEADER", "MAIN", "FOOTER"]);
    expect(screen.getByRole("banner")).toBe(header);
    expect(screen.getByRole("contentinfo")).toBe(footer);
    // The first screen starts under the header, and the old bar inside it is gone.
    expect(main.firstElementChild?.classList.contains("h-hero")).toBe(true);
    expect(main.querySelector("header, footer")).toBeNull();
    // One white pill in the header: Start free. Sign in is a plain link beside it.
    expect([...header.querySelectorAll(".h-btn")].map((a) => a.textContent)).toEqual(["Start free"]);
    const footerLinks = [...footer.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(footerLinks).toEqual([
      ["Sign in", "/login"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["help@arush.dev", "mailto:help@arush.dev"],
    ]);
    expect(footer.textContent).toContain("© 2026 EasyEdit");
  });

  it("ends its main with the page's dock: a clip for each section after the first screen, in page order", async () => {
    render(await Home());
    const main = screen.getByRole("main");
    const dock = within(main).getByRole("navigation", { name: "Page" });
    expect(main.lastElementChild).toBe(dock);
    const sections = [...main.children].filter((el) => el.tagName === "SECTION" && el.id) as HTMLElement[];
    expect(sections.length).toBeGreaterThan(3);
    // Every section names its clip in a few words.
    for (const section of sections) expect(section.dataset.dockLabel, section.id).toMatch(/^\S+( \S+){0,2}$/);
    const links = [...dock.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual(sections.map((section) => [section.dataset.dockLabel, `#${section.id}`]));
    // The dock is the first screen's timeline folded up, so that timeline is there to fold: drawn on its own under
    // the editor, its tracks named by kind, the video track (the one the dock's track rides on) among them.
    const timeline = document.querySelector(".h-hero > .h-edTimeline") as HTMLElement;
    expect(timeline.hasAttribute("data-ui")).toBe(true);
    expect(timeline.previousElementSibling?.classList.contains("h-ed")).toBe(true);
    expect([...timeline.querySelectorAll(".h-edTrack")].map((t) => (t as HTMLElement).dataset.track)).toEqual([
      "text",
      "video",
      "audio",
    ]);
    // All of it is decoration but its play button, which is the first screen's Pause.
    const exposed = [...timeline.children].filter((el) => el.getAttribute("aria-hidden") !== "true");
    expect(exposed.map((el) => [el.tagName, el.getAttribute("aria-label")])).toEqual([["BUTTON", "Pause"]]);
    // The dock's clips start out as that video track's clips: their names and pictures, for the eye only.
    const from = [...dock.querySelectorAll(".h-dockFrom")];
    expect(from.map((el) => el.textContent)).toEqual(["bonfire.mp4", "shibuya.mp4", "ridge.mp4", "wave.mp4"]);
    for (const el of from) expect(el.getAttribute("aria-hidden")).toBe("true");
    // Nothing marks an end of the page for it any more: held at the top, it is never over the close or the footer.
    expect(main.querySelector("[data-dock-end]")).toBeNull();
  });

  it("draws its stills and posters from WebP files in public/home, each img sized to its file's shape", async () => {
    render(await Home());
    const images = [...document.querySelectorAll("img")].filter((img) => img.getAttribute("src")?.startsWith("/home/"));
    const posters = [...document.querySelectorAll("video")].map((video) => video.getAttribute("poster") ?? "");
    expect(images.length).toBeGreaterThan(0);
    expect(posters).toHaveLength(4);
    for (const src of [...images.map((img) => img.getAttribute("src") ?? ""), ...posters]) {
      expect(src).toMatch(/^\/home\/[\w-]+\.webp$/);
      expect(existsSync(join(process.cwd(), "public", src)), src).toBe(true);
    }
    // The width and height reserve the image's space before it loads, so they must keep the file's own shape.
    for (const img of images) {
      const src = img.getAttribute("src") ?? "";
      const file = webpSize(readFileSync(join(process.cwd(), "public", src)));
      const width = Number(img.getAttribute("width"));
      const height = Number(img.getAttribute("height"));
      expect(width * file.height, `${src} at ${width}x${height}`).toBe(height * file.width);
    }
  });

  it("goes from the agent demo straight to the first project, then free, teams and every agent", async () => {
    render(await Home());
    const main = screen.getByRole("main");
    const sections = [...main.children].filter((el) => el.tagName === "SECTION" && el.id);
    expect(sections.map((el) => el.id)).toEqual(["ai", "start", "free", "teams", "agents", "timeline"]);
    const names = sections.map((el) => within(el as HTMLElement).getAllByRole("heading", { level: 2 })[0]);
    expect(names.map((h) => h.textContent)).toEqual([
      "Ask an agent. Watch it edit.",
      "Make your first project.",
      "Free, and your files stay in your Drive.",
      "Built for teams.",
      "Works with every AI agent.",
      "You and your agent share one timeline.",
    ]);
    // One size for every section heading; only the first screen's headline is larger.
    for (const h of names) expect(h.className.split(" "), h.id).toContain("h-h2");
    expect(main.querySelector(".h-display")).toBeNull();
    for (const el of sections) expect(el.getAttribute("aria-labelledby"), el.id).toBe(names[sections.indexOf(el)].id);
    // The form is the first project section's own, right after its heading.
    expect(within(sections[1] as HTMLElement).getByRole("form", { name: "New project" })).toBeTruthy();
  });

  it("sets the agent demo's heading and lead first, then the editor, what its agent did and the requests", async () => {
    render(await Home());
    const ai = document.getElementById("ai")!;
    const heading = within(ai).getByRole("heading", { level: 2, name: "Ask an agent. Watch it edit." });
    const requests = within(ai).getByRole("list", { name: "Ask an agent" });
    const stage = within(ai).getByRole("figure", { name: "A working model of the editor" });
    // The order a phone shows them in, one under the other; a computer only moves the editor, with what its agent did
    // under it, to a column of its own.
    const demo = heading.parentElement!;
    expect(demo.classList.contains("h-demo")).toBe(true);
    expect([...demo.children].map((el) => el.tagName)).toEqual(["H2", "P", "DIV", "UL"]);
    const show = demo.children[2];
    expect(show.className).toBe("h-demoShow");
    expect([...show.children]).toEqual([demo.querySelector(".h-ask"), stage, demo.querySelector(".h-demoAnswer")]);
    expect(demo.children[3]).toBe(requests);
    expect(ai.querySelector(".h-demoText, .h-sectionHead, .h-points, h3")).toBeNull();
    // The old three points live on as the requests' own result lines.
    for (const gone of ["Plain words in, real edits out", "Signed and undoable", "It works as you"]) {
      expect(ai.textContent).not.toContain(gone);
    }
    expect(stage.querySelector(":scope > [data-ui]")).toBeTruthy();
    expect(stage.querySelector("figcaption")).toBeNull();
  });

  it("says where asking happens: in the agent you already use, and the edit lands here", async () => {
    render(await Home());
    const ai = document.getElementById("ai")!;
    expect(within(ai).getByRole("heading", { level: 2 }).nextElementSibling!.textContent).toBe(
      "You ask in Claude, ChatGPT or another AI agent you already use. It edits your project here, and you see every change. Pick a request to watch one land in a working model of the editor.",
    );
    expect(document.querySelector(".h-page")!.textContent).not.toContain("speaks MCP");
  });

  it("draws each request as the person's message in that agent's own app, above the editor where it lands", () => {
    render(<AgentDemo />);
    const ask = document.querySelector<HTMLElement>(".h-ask")!;
    // A drawn piece of an app, kept from screen readers: the request buttons say the same words.
    expect(ask.hasAttribute("data-ui")).toBe(true);
    expect(ask.getAttribute("aria-hidden")).toBe("true");
    const chats = [...ask.querySelectorAll<HTMLElement>(".h-askChat")];
    expect(chats.map((c) => [c.dataset.agent, c.querySelector(".h-askApp")?.textContent, c.querySelector(".h-askMsg")?.textContent])).toEqual(
      REQUESTS.map((r) => [r.agent, r.agent, r.words]),
    );
    for (const chat of chats) expect(chat.querySelector(".h-askTool")?.textContent).toBe("EasyEdit connector");
    const on = () => chats.filter((c) => c.hasAttribute("data-on")).map((c) => c.dataset.agent);
    expect(on()).toEqual(["Claude"]);
    fireEvent.click(screen.getByRole("button", { name: /Make the surf shot two seconds long/ }));
    expect(on()).toEqual(["ChatGPT"]);
    // Each agent's own mark, coloured as that agent's edits are.
    const marks = chats.map((c) => c.querySelector<HTMLElement>(".h-askLogo")!.style.maskImage);
    expect(marks).toEqual(REQUESTS.map((r) => `url(/home/logos/${r.logo}.svg)`));
    const rules = cssRules(readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8"));
    const decl = (selector: string, prop: string) =>
      rules.find((r) => r.media === null && r.selectors.includes(selector))?.decls.get(prop);
    expect(decl('.h-askChat[data-agent="Claude"]', "--agent")).toBe("var(--h-claude)");
    expect(decl(".h-askChat:not([data-on])", "visibility")).toBe("hidden");
    expect(decl(".h-ask", "box-shadow")).toBe("0 0 0 1px var(--ed-line-strong)");
  });

  it("takes the keyboard from the editor's Undo to the requests and then on to the first project", async () => {
    render(await Home());
    const ai = document.getElementById("ai")!;
    const start = document.getElementById("start")!;
    const stops = [...ai.querySelectorAll("button, a[href], input, [tabindex]:not([tabindex='-1'])")];
    expect(stops.map((el) => el.textContent?.replace(/^(.*?)Ask \w+$/, "$1"))).toEqual([
      "Undo this change",
      ...REQUESTS.map((r) => r.words),
    ]);
    // The section's next stop is the first project's name field, after the last request.
    const name = within(start).getByRole("textbox", { name: "Name" });
    expect(stops.at(-1)!.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says EasyEdit is in closed beta while sign-up is closed, and the buttons just sign in", async () => {
    vi.stubEnv("OPEN_SIGNUP", "");
    render(await Home());
    expect(screen.getByText("EasyEdit is in closed beta. Sign-in is by invitation only for now.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Start free" })).toBeNull();
    const primary = document.querySelector(".h-heroActions .h-btn");
    expect([primary?.textContent, primary?.getAttribute("href")]).toEqual(["Sign in", "/login"]);
    // The close at the end of the page is the one white pill, Sign in, too.
    const close = document.querySelector(".h-closeActions")!;
    expect([...close.querySelectorAll("a")].map((a) => [a.textContent, a.className, a.getAttribute("href")])).toEqual([
      ["Sign in", "h-btn", "/login"],
    ]);
    vi.unstubAllEnvs();
  });

  it("drops the closed beta note once sign-up is open", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    render(await Home());
    expect(screen.queryByText(/closed beta/)).toBeNull();
    expect(screen.queryByText(/by invitation only/)).toBeNull();
    vi.unstubAllEnvs();
  });

  it("signed in goes to the dashboard", async () => {
    signedIn.user = ada;
    await expect(Home()).rejects.toMatchObject({ to: "/dashboard" });
  });
});

describe("home page free, teams and every agent", () => {
  it("says what free and in your Drive come to as a list of plain sentences, with the Storage page as the picture", async () => {
    render(await Home());
    const free = document.getElementById("free")!;
    const heading = within(free).getByRole("heading", { level: 2 });
    expect([...heading.querySelectorAll(".h-line")].map((line) => line.textContent)).toEqual([
      "Free, and your files",
      "stay in your Drive.",
    ]);
    expect(heading.className).toBe("h-h2");
    const facts = within(free).getByRole("list");
    expect(within(facts).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "It costs nothing, teams included.",
      "It keeps them in a folder of its own.",
      "It can't see your other files.",
      "Exports render on your computer.",
    ]);
    // Its own layout: the heading, the list right under it, then the picture. No head row, no cards.
    expect([...free.children].map((el) => el.tagName)).toEqual(["H2", "UL", "DIV"]);
    expect(free.querySelector("h3, article, .h-sectionHead")).toBeNull();
    const picture = free.lastElementChild!;
    expect(picture.classList.contains("h-driveStage")).toBe(true);
    expect([picture.hasAttribute("data-ui"), picture.getAttribute("aria-hidden")]).toEqual([true, "true"]);
    // The made-up person's address is on the domain kept for examples, not a real one.
    expect(picture.textContent).toContain("Stored in maya@example.com's Google Drive");
    expect(picture.textContent).not.toMatch(/@(?!example\.com)[\w-]+\.\w+/);
  });

  it("shows a team as one drawn editor: who is here, each person's selection by name, Undo on a teammate's change", async () => {
    render(await Home());
    const teams = document.getElementById("teams")!;
    // One picture, the shared editor, and no grid of cards.
    const scenes = teams.querySelectorAll(":scope > [data-ui]");
    expect(scenes).toHaveLength(1);
    const scene = scenes[0] as HTMLElement;
    expect([scene.className, scene.getAttribute("aria-hidden")]).toEqual(["h-tm", "true"]);
    expect(teams.querySelector("article, .h-teamGrid, .h-teamCard")).toBeNull();
    // The top bar's dots: you, then a dot with each teammate's initials.
    expect(scene.querySelector(".h-tmPeople > .h-tmMe")).toBeTruthy();
    expect([...scene.querySelectorAll(".h-tmDot")].map((dot) => dot.textContent)).toEqual(["SO", "MK"]);
    // Every selection carries its person's colour and name.
    const tags = [...scene.querySelectorAll(".h-tmFrame .h-edPeerTag")];
    expect(tags.map((tag) => tag.textContent)).toEqual(["Mika", "Sam", "You"]);
    const colours = tags.map((tag) => (tag.parentElement as HTMLElement).style.getPropertyValue("--peer"));
    expect(colours).toEqual(["var(--ed-peer-2)", "var(--ed-peer-1)", "var(--ed-accent)"]);
    expect([...scene.querySelectorAll(".h-tmBadge")].map((badge) => badge.textContent)).toEqual(["SO", "MK"]);
    // Activity, newest first, in the app's wording; a teammate's change is the newest and can be undone.
    const rows = [...scene.querySelectorAll(".h-tmActivity li")];
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      "Sam Okafor · Added text",
      "Mika Kato · Changed a video clip: position and scale",
      "You · Added an image",
      "Claude (for Mika Kato) · Split a video clip",
    ]);
    for (const row of rows) expect(row.querySelector(".h-tmUndo")?.textContent).toBe("Undo this change");
    // It is a picture: nothing in it can take the focus.
    expect(scene.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
  });

  it("spells color the way the app's own screens do (the brand kit's Colors, Add color)", async () => {
    render(await Home());
    const main = screen.getByRole("main");
    expect(main.textContent).toContain("Each person's selection shows in their color with their name on it");
    expect(document.querySelector(".h-tmKit")?.textContent).toContain("Colors");
    expect(main.textContent).not.toMatch(/colour/i);
  });

  it("shows the team's brand kit inside its editor, as the Brand kit tab, with no row of facts under it", async () => {
    render(await Home());
    const teams = document.getElementById("teams")!;
    // The section is its heading, its lead (which names the team space) and the one drawn editor.
    expect([...teams.children].map((el) => el.tagName)).toEqual(["H2", "P", "DIV"]);
    expect(teams.querySelector(".h-teamFacts, h3")).toBeNull();
    expect(teams.querySelector(".h-lead")?.textContent).toMatch(/^Everyone in a team space edits the same project/);
    // The left panel is open on Brand kit, which lists the kit as the app's tab does: fonts, colors, logos.
    const scene = teams.querySelector(".h-tm")!;
    const kit = scene.querySelector(".h-tmKit")!;
    expect(kit.querySelector(".h-tmTabs [data-on]")?.textContent).toBe("Brand kit");
    expect([...kit.querySelectorAll(".h-kitHead")].map((h) => h.textContent)).toEqual(["Fonts", "Colors", "Logos"]);
    expect([...kit.querySelectorAll(".h-kitFont")].map((f) => [f.firstElementChild?.textContent, f.lastElementChild?.textContent])).toEqual([
      ["Title", "Bebas Neue"],
      ["Subtitle", "Montserrat"],
      ["Body text", "Inter"],
    ]);
    expect(kit.querySelectorAll(".h-kitSwatch")).toHaveLength(4);
    expect(kit.querySelector("svg.h-kitLogo")).toBeTruthy();
    // What is in the picture comes from the kit: its logo, which you have selected.
    expect(scene.querySelector(".h-tmLogo svg")).toBeTruthy();
    // Every picture in the section is footage inside the drawn editor: no screenshots of the app.
    const images = [...teams.querySelectorAll("img")];
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect(img.getAttribute("src")).toMatch(/^\/home\/still-[\w-]+\.webp$/);
      expect(img.closest(".h-tm[data-ui]")).toBeTruthy();
    }
  });

  it("names the agents once, in the moving row, which screen readers get as a list", async () => {
    render(await Home());
    const agents = document.getElementById("agents")!;
    const heading = within(agents).getByRole("heading", { level: 2 });
    expect([...heading.querySelectorAll(".h-line")].map((line) => line.textContent)).toEqual(["Works with", "every AI agent."]);
    expect(heading.className).toBe("h-h2");
    const list = within(agents).getByRole("list", { name: "AI agents" });
    const names = ["Claude", "ChatGPT", "Claude Code", "Codex", "Cursor", "Gemini CLI", "VS Code Copilot"];
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(names);
    // Each with a mark of its own: no two agents in the row share one.
    const marks = [...list.querySelectorAll<HTMLElement>(".h-agentLogo")].map((mark) => mark.style.maskImage);
    expect(new Set(marks).size).toBe(names.length);
    expect(list.closest("[aria-hidden]")).toBeNull();
    // The second copy, which closes the loop, is for the eye only.
    const copies = agents.querySelectorAll(".h-marqueeList");
    expect(copies).toHaveLength(2);
    expect(copies[1].getAttribute("aria-hidden")).toBe("true");
    // The line under the heading says what connects and where, and lists no names.
    const line = heading.nextElementSibling!;
    expect(line.textContent!.replace(/\u00a0/g, " ")).toBe(
      "Any AI agent that supports MCP, the standard way agents connect to apps, can edit your projects. Once you've signed up, the AI agents page shows the steps for yours: add EasyEdit's link to your agent, sign in and choose Allow.",
    );
    // Nothing a signed-out visitor doesn't have, like an account menu.
    expect(line.textContent).not.toContain("account menu");
    for (const name of names) expect(line.textContent).not.toContain(name);
  });

  it("ends the page with Start free and Sign in, before the footer", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    render(await Home());
    vi.unstubAllEnvs();
    const agents = document.getElementById("agents")!;
    // A beat of its own, the section after the agents and the last clip on the page's dock: you and your agent on one
    // project, set as two lines, then the action. It is the page's shortest section, so its clip is the dock's
    // narrowest (8% of the track, about 70 px at 1024 px wide), and its name is one short word that fits it whole.
    const close = agents.nextElementSibling as HTMLElement;
    expect([close.tagName, close.className, close.id, close.dataset.dockLabel]).toEqual([
      "SECTION",
      "h-section h-close",
      "timeline",
      "Start",
    ]);
    const heading = within(close).getByRole("heading", { level: 2, name: "You and your agent share one timeline." });
    expect(close.getAttribute("aria-labelledby")).toBe(heading.id);
    expect([...heading.querySelectorAll(".h-line")].map((l) => l.textContent)).toEqual(["You and your agent", "share one timeline."]);
    // Said nowhere else on the page.
    const main = screen.getByRole("main");
    expect(main.textContent!.split("share one timeline").length).toBe(2);
    expect(close.lastElementChild?.className).toBe("h-closeActions");
    expect([...close.querySelectorAll("a")].map((a) => [a.textContent, a.className, a.getAttribute("href")])).toEqual([
      ["Start free", "h-btn", "/login"],
      ["Sign in", "h-closeLink", "/login"],
    ]);
    // The agents' section ends with its row, the row's Pause right before it, at its leading edge.
    expect(agents.lastElementChild?.classList.contains("h-marquee")).toBe(true);
    expect(agents.lastElementChild?.previousElementSibling?.classList.contains("h-marqueePause")).toBe(true);
    // The close is the last section in main, and the footer comes after main.
    expect([...main.querySelectorAll(":scope > section")].at(-1)).toBe(close);
    expect(main.nextElementSibling).toBe(screen.getByRole("contentinfo"));
  });

  it("keeps every drawn piece of the app inside a root marked data-ui", async () => {
    render(await Home());
    const drawn = [...document.querySelectorAll("main [class*='h-ed'], main [class*='h-ui'], main [class*='h-tm'], main [class*='h-kit'], main [class*='h-shot'], main [class*='h-drive'], main [class*='h-dock']")];
    expect(drawn.length).toBeGreaterThan(100);
    for (const el of drawn) expect(el.closest("[data-ui]"), el.className).toBeTruthy();
    for (const root of [".h-ed", ".h-edTimeline", ".h-ui", ".h-tm", ".h-driveStage", ".h-np"]) {
      expect(document.querySelector(root)?.hasAttribute("data-ui"), root).toBe(true);
    }
  });
});

describe("home page stylesheet (home.css)", () => {
  const rules = cssRules(readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8"));
  // The drawn pieces of the app keep the app's own sizes, colours, edges and dividers.
  const DRAWN = /^\.h-(ed|ui|ask|tm|kit|shot|drive|dock|np|heroBox|heroHandle|heroTag)/;
  const own = (selector: string) => !DRAWN.test(selector.replace(/^\.h-(hero|page)(\[[^\]]*\])? /, ""));
  const pageRules = rules.filter((r) => r.selectors.some(own) && !/^(from|to|\d+%)$/.test(r.selectors[0]));

  it("sets the page's own words in five sizes: display, h2, lead, body and small", () => {
    const tokens = rules.find((r) => r.media === null && r.selectors.includes(".h-page"))!.decls;
    for (const size of ["--h-display", "--h-h2", "--h-lead", "--h-body", "--h-small"]) expect(tokens.has(size), size).toBe(true);
    const sizes = new Set(pageRules.flatMap((r) => (r.decls.has("font-size") ? [r.decls.get("font-size")] : [])));
    expect([...sizes].sort()).toEqual(["var(--h-body)", "var(--h-display)", "var(--h-h2)", "var(--h-lead)", "var(--h-small)"]);
    // On a phone the display size changes, to fit the longer line of a two-line headline; nothing else changes size.
    const phone = rules.filter((r) => r.media === "@media (max-width: 860px)" && r.selectors.includes(".h-page"));
    expect(phone.flatMap((r) => [...r.decls.keys()])).toEqual(["--h-display"]);
    // Display type stops at 96 px (6rem) on every window.
    const displaySizes = rules.filter((r) => r.decls.has("--h-display")).map((r) => r.decls.get("--h-display"));
    expect(displaySizes).toHaveLength(2);
    for (const value of displaySizes) expect(value).toMatch(/^clamp\(.*, 96px\)$/);
    const resized = rules.filter((r) => r.media !== null && r.selectors.some(own) && r.decls.has("font-size"));
    expect(resized).toEqual([]);
    // The display size is the first screen's headline's alone; every section heading is h2.
    const display = pageRules.filter((r) => r.decls.get("font-size") === "var(--h-display)").flatMap((r) => r.selectors);
    expect(display).toEqual([".h-heroTitle"]);
  });

  it("keeps every line's tracking at -0.04em or looser, and the site's page titles as tight as its section headings", () => {
    const site = cssRules(readFileSync(join(process.cwd(), "src/components/site/site.css"), "utf8"));
    const tracked = [...rules, ...site].flatMap((r) => {
      const value = r.decls.get("letter-spacing");
      return value?.endsWith("em") ? [[r.selectors.join(", "), Number.parseFloat(value)] as const] : [];
    });
    expect(tracked.length).toBeGreaterThan(5);
    for (const [where, em] of tracked) expect(em, where).toBeGreaterThanOrEqual(-0.04);
    const spacing = (list: typeof rules, selector: string) =>
      list.find((r) => r.media === null && r.selectors.includes(selector))?.decls.get("letter-spacing");
    expect(spacing(rules, ".h-h2")).toBe("-0.04em");
    expect(spacing(site, ".h-plainTitle")).toBe(spacing(rules, ".h-h2"));
    expect(spacing(rules, ".h-heroTitle")).toBe(spacing(rules, ".h-h2"));
  });

  it("leads the Free section from its heading to its list by size and weight, in full ink, each line apart", () => {
    const rule = (selector: string, media: string | null = null) =>
      rules.find((r) => r.media === media && r.selectors.includes(selector))!.decls;
    // The heading at the h2 size every section heading has; the list a clear step under it, at the lead size and a
    // step lighter, in the same white, so no line of it is as large as a heading.
    expect([rule(".h-h2").get("font-size"), rule(".h-h2").get("font-weight")]).toEqual(["var(--h-h2)", "600"]);
    const facts = rule(".h-facts");
    expect([facts.get("font-size"), facts.get("font-weight"), facts.get("color")]).toEqual(["var(--h-lead)", "500", "var(--h-text)"]);
    // More room under the heading than between the lines, and between the lines than their leading.
    const em = (value: string | undefined) => Number(/^([\d.]+)em/.exec(value ?? "")?.[1]);
    expect(em(facts.get("margin"))).toBeGreaterThan(em(facts.get("gap")));
    expect(em(facts.get("gap"))).toBeGreaterThanOrEqual(0.6);
    // On a computer the list stands beside the heading along its foot, in the first screen's side column, and the
    // Storage page runs across under both.
    const desktop = "@media (width > 860px)";
    const free = rule(".h-free", desktop);
    expect([free.get("display"), free.get("grid-template-columns"), free.get("align-items")]).toEqual([
      "grid",
      "auto minmax(0, 30rem)",
      "end",
    ]);
    expect(rule(".h-free > .h-facts", desktop).get("margin-top")).toBe("0");
    expect(rule(".h-free > .h-driveStage", desktop).get("grid-column")).toBe("1 / -1");
  });

  it("puts every section on the one black ground, with no panel greys, shadows, gradients or fades", () => {
    for (const rule of pageRules) {
      const where = rule.selectors.join(", ");
      const fill = rule.decls.get("background") ?? rule.decls.get("background-color");
      if (fill !== undefined) expect(fill, where).toMatch(/^(#000|currentColor|var\(--tone\)|rgb\(255 255 255 \/ 0\.\d+\))$/);
      expect(rule.decls.has("box-shadow"), where).toBe(false);
      expect(rule.decls.has("mask-image"), where).toBe(false);
    }
    expect(rules.some((r) => [...r.decls.values()].some((v) => /gradient\(/.test(v)))).toBe(false);
    // The drawn team, kit and Drive pieces float over nothing either: their edges are the app's 1 px window edge.
    const pieces = rules.filter((r) => r.selectors.some((s) => /^\.h-(tm|kit|shot|drive)/.test(s)));
    expect(pieces.length).toBeGreaterThan(30);
    for (const rule of pieces) expect(rule.decls.has("box-shadow"), rule.selectors.join(", ")).toBe(false);
  });

  it("runs the agents' row across the whole window, and under reduced motion stands it in rows without its copy", () => {
    const marquee = rules.find((r) => r.media === null && r.selectors.includes(".h-marquee"))!;
    // From the window's left edge to its right one: back over the section's margin on the left, past the end of the
    // page's column on the right. The row itself starts at the page's left margin, its Pause pill right above it.
    expect(marquee.decls.get("margin")).toBe("16px calc(100% + var(--h-pad) - 100vw) 0 calc(-1 * var(--h-pad))");
    const pause = rules.find((r) => r.media === null && r.selectors.includes(".h-marqueePause"))!;
    expect([pause.decls.get("display"), pause.decls.get("margin-top")]).toEqual(["block", "clamp(48px, 5vw, 72px)"]);
    expect(pause.decls.has("margin-left")).toBe(false);
    expect(marquee.decls.get("padding-left")).toBe("var(--h-pad)");
    expect(marquee.decls.has("mask-image")).toBe(false);
    // Each copy ends with the gap before the next, so half the track's width is exactly one copy.
    const list = rules.find((r) => r.media === null && r.selectors.includes(".h-marqueeList"))!;
    expect([list.decls.get("gap"), list.decls.get("padding")]).toEqual(["var(--gap)", "0 var(--gap) 0 0"]);
    const reduced = rules.filter((r) => r.media === "@media (prefers-reduced-motion: reduce)");
    const rule = (selector: string) => reduced.find((r) => r.selectors.includes(selector))?.decls;
    expect(rule(".h-marqueeList[aria-hidden]")?.get("display")).toBe("none");
    expect(rule(".h-marqueeList")?.get("flex-wrap")).toBe("wrap");
    expect([rule(".h-marquee")?.get("margin-inline"), rule(".h-marquee")?.get("padding-left")]).toEqual(["0", "0"]);
    // With no Pause pill above the rows, they keep its room under the line before them.
    expect(rule(".h-marquee")?.get("margin-top")).toBe(pause.decls.get("margin-top"));
  });

  it("gives the close a section's gap of its own under the agents, its heading right over the action", () => {
    const base = (selector: string) => rules.find((r) => r.media === null && r.selectors.includes(selector))!.decls;
    expect(base(".h-section").get("padding")).toBe("clamp(120px, 14vw, 180px) var(--h-pad) 0");
    expect(rules.some((r) => r.media === null && r.selectors.includes(".h-close"))).toBe(false); // a section like the others
    expect(base(".h-closeActions").get("margin-top")).toBe("clamp(32px, 3.5vw, 48px)");
    // The page's own room before the footer.
    expect(base(".h-page").get("--h-room")).toBe("clamp(80px, 11vw, 140px)");
    expect(base(".h-page").get("padding-bottom")).toBe("var(--h-room)");
  });

  it("ends a computer's last screen in a gap, over the agents' heading or their Pause, with a section's gap at most", () => {
    const at = (media: string, selector: string) => rules.find((r) => r.media === media && r.selectors.includes(selector))?.decls;
    const close = at("@media (width > 860px)", ".h-close")!;
    // --h-fit starts the last screen 24 px above the agents' heading, with the rest of the page under it: those 24 px,
    // the two-line heading (2 of h2), 28 px and the lead's two lines (3 of lead), the gap over the Pause, the pill and
    // the 16 px under it (30 + 16), the row (1.2 of h2), the close's heading (2 of h2) with the room over its 52 px
    // pill, the page's room and the 112 px footer.
    expect(close.get("--h-fit")).toBe(
      "calc( 100svh - 262px - var(--h-h2) * 5.2 - var(--h-lead) * 3 - clamp(48px, 5vw, 72px) - clamp(32px, 3.5vw, 48px) - var(--h-room) )",
    );
    expect(24 + 28 + 30 + 16 + 52 + 112).toBe(262);
    // --h-lift is what the heading, its lead and the gap over the Pause took: without room for them, the last screen
    // starts 24 px above the Pause instead.
    expect(close.get("--h-lift")).toBe("calc(var(--h-h2) * 2 + 28px + var(--h-lead) * 3 + clamp(48px, 5vw, 72px))");
    expect(close.get("padding-top")).toBe(
      "max( 48px, min(var(--h-fit), clamp(120px, 14vw, 180px)) + var(--h-lift) - clamp(0px, (var(--h-fit) - 48px) * 1000, var(--h-lift)) )",
    );
    // Those 24 px are inside the gap between the lead and the Pause at every width (48 px at its least), so no line of
    // the lead shows.
    const pause = rules.find((r) => r.media === null && r.selectors.includes(".h-marqueePause"))!.decls;
    expect(pause.get("margin-top")).toBe("clamp(48px, 5vw, 72px)");
    expect(24).toBeLessThan(48);
    // A short computer screen keeps less room before the footer, so the close can keep more above it.
    expect(at("@media (width > 860px) and (height <= 800px)", ".h-page")?.get("--h-room")).toBe("80px");
    // The room above the close, worked through for a few windows (in px, the window's width and height).
    const clamp = (lo: number, value: number, hi: number) => Math.min(Math.max(value, lo), hi);
    const room = (w: number, h: number) => {
      const h2 = Math.min(clamp(38, 0.052 * w, 76), (w - 2 * clamp(20, 0.03 * w, 40)) / 9.2);
      const lead = clamp(17, 0.013 * w, 20);
      const over = clamp(48, 0.05 * w, 72);
      const page = h <= 800 ? 80 : clamp(80, 0.11 * w, 140);
      const fit = h - 262 - h2 * 5.2 - lead * 3 - over - clamp(32, 0.035 * w, 48) - page;
      const lift = h2 * 2 + 28 + lead * 3 + over;
      return Math.max(48, Math.min(fit, clamp(120, 0.14 * w, 180)) + lift - clamp(0, (fit - 48) * 1000, lift));
    };
    // The whole agents' section in the last screen, 24 px of room above its heading; on a taller window a section's
    // gap at most, the window's top higher in the room above the heading.
    expect(room(1920, 1080)).toBeCloseTo(102.8, 1);
    expect(room(1920, 1200)).toBe(180);
    // No room for the heading as well: the last screen starts 24 px above the Pause, as it did before.
    expect(room(1920, 1025)).toBeCloseTo(359.8, 1);
    expect(room(1920, 1026)).toBeCloseTo(48.8, 1);
    expect(room(1440, 900)).toBeCloseTo(238.4, 1);
    expect(room(1024, 768)).toBeCloseTo(247.8, 1);
    // With reduced motion the agents stand in rows, as many as the width makes, with no Pause: the room is what it
    // would be at the Pause, but never more than a section's gap, so the end opens no hole above the close.
    const still = "@media (width > 860px) and (prefers-reduced-motion: reduce)";
    expect(at(still, ".h-close")?.get("padding-top")).toBe(
      "clamp(48px, var(--h-fit) + var(--h-lift), clamp(120px, 14vw, 180px))",
    );
    // Under 660 px tall there is no room for the row and the close together: the row goes on up instead, its foot
    // 24 px over the window's top. It comes after the reduced-motion rule, so a short window takes it either way.
    const short = "@media (width > 860px) and (height < 660px)";
    expect(at(short, ".h-close")?.get("padding-top")).toBe(
      "max( clamp(120px, 14vw, 180px), 100svh - 140px - var(--h-h2) * 2 - clamp(32px, 3.5vw, 48px) - var(--h-room) )",
    );
    expect(52 + 112 - 24).toBe(140);
    const index = (media: string) => rules.findIndex((r) => r.media === media && r.selectors.includes(".h-close"));
    expect(index(still)).toBeLessThan(index(short));
    // The widest window's row and close fit from 660 px tall: the room left is never under 48 px there.
    const h2 = 76;
    expect(660 - 234 - h2 * 3.2 - 48 - 80).toBeGreaterThanOrEqual(48);
  });

  it("keeps every section on the first screen's left edge, the first one starting a fold nearer the timeline", () => {
    const section = rules.find((r) => r.media === null && r.selectors.includes(".h-section"))!.decls;
    expect(section.has("margin")).toBe(false);
    expect(section.get("max-width")).toBe("calc(var(--h-column) + 2 * var(--h-pad))");
    const first = rules.filter((r) => r.selectors.includes(".h-hero + .h-section"));
    expect(first.map((r) => r.media)).toEqual([
      "@media (width > 860px)",
      "@media (width > 860px)",
      "@media (width > 860px) and (prefers-reduced-motion: reduce)",
    ]);
    expect(first[0].decls.get("padding-top")).toBe("calc(clamp(120px, 14vw, 180px) - var(--h-fold))");
    expect(first.slice(1).every((r) => [...r.decls.keys()].join() === "scroll-margin-top")).toBe(true);
  });

  it("lands every section with its top on the dock's foot, so nothing of the one before shows between them", () => {
    const desktop = "@media (width > 860px)";
    const decl = (media: string | null, selector: string, name: string) =>
      rules.find((r) => r.media === media && r.selectors.includes(selector) && r.decls.has(name))?.decls.get(name);
    // Once the dock shows, the browser stops 72 px down for whatever it brings into view (16 px under the dock);
    // before that, nothing.
    const padding = Number.parseFloat(decl(null, "html:has(.h-dock[data-shown])", "scroll-padding-top")!);
    expect(padding).toBe(72);
    // A section asks for what puts its top right on the dock's 56 px foot on top of that, either way.
    const land = (selector: string) => Number.parseFloat(decl(desktop, selector, "--h-land")!);
    expect(land(".h-page")).toBe(56);
    expect(padding + land("html:has(.h-dock[data-shown]) .h-page")).toBe(56);
    expect(decl(desktop, ".h-section", "scroll-margin-top")).toBe("var(--h-land)");
    // The first section's room starts a fold higher, at the first screen's emptied foot, so its heading lands a
    // section's gap under the dock, as every other's does.
    expect(decl(desktop, ".h-hero + .h-section", "scroll-margin-top")).toBe("calc(var(--h-fold) + var(--h-land))");
    // With reduced motion the timeline goes up with the page, and the dock is there once all of it is past the
    // window's top, with the first screen's foot a fold down: the first section lands its top there, 120 px down,
    // whether the dock is showing yet or not, so none of the timeline shows above it and the dock is there.
    const still = "@media (width > 860px) and (prefers-reduced-motion: reduce)";
    expect(decl(still, ".h-hero + .h-section", "scroll-margin-top")).toBe("calc(var(--h-fold) - 56px + var(--h-land))");
    expect(120 - 56 + land(".h-page")).toBe(120);
    expect(120 - 56 + land("html:has(.h-dock[data-shown]) .h-page") + padding).toBe(120);
    // A link to the close asks for more than the page can scroll, so it lands on the page's very end, wherever the
    // close stands in the last screen.
    expect(decl(desktop, ".h-close", "scroll-margin-top")).toBe("-100vh");
    // On a phone there is no dock, and nothing changes where a link lands.
    for (const rule of rules.filter((r) => r.media !== desktop && r.media !== still)) {
      expect(rule.decls.has("scroll-margin-top"), rule.selectors.join(", ")).toBe(false);
      expect(rule.decls.has("--h-land"), rule.selectors.join(", ")).toBe(false);
    }
  });
});

describe("home page new project form", () => {
  beforeEach(() => {
    push.mockClear();
    window.sessionStorage.clear();
  });

  it("shows the typed name in the preview and the chosen format's size", () => {
    render(<NewProjectForm />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Launch teaser" } });
    expect(screen.getByText("Launch teaser")).toBeTruthy();
    expect(screen.getByText("1080 × 1920 px · 30 fps")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Landscape 16:9/ }));
    expect(screen.getByText("1920 × 1080 px · 30 fps")).toBeTruthy();
  });

  it("offers a custom size and refuses one outside the limits", () => {
    render(<NewProjectForm />);
    fireEvent.click(screen.getByRole("radio", { name: /Custom size/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Width (px)" }), { target: { value: "5" } });
    expect(screen.getByRole("alert").textContent).toContain("Width and height go from");
    expect(screen.getByRole("button", { name: "Create project" }).hasAttribute("disabled")).toBe(true);
  });

  it("Create project keeps the name and format in the tab and goes to sign in, which carries on to /new", () => {
    render(<NewProjectForm />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Beach day recap" } });
    fireEvent.click(screen.getByRole("radio", { name: /Landscape 16:9/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(push).toHaveBeenCalledWith("/login?next=%2Fnew");
    expect(JSON.parse(window.sessionStorage.getItem(FIRST_PROJECT_KEY)!)).toEqual({
      name: "Beach day recap",
      format: "long_16x9",
      width: "1080",
      height: "1080",
      asked: true,
    });
  });

  it("finds what was typed again on the way Back from sign-in, not yet asked for", () => {
    const first = render(<NewProjectForm />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Dog park" } });
    fireEvent.click(screen.getByRole("radio", { name: /Custom size/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Width (px)" }), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    first.unmount();

    render(<NewProjectForm />);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe("Dog park");
    expect(screen.getByRole("radio", { name: /Custom size/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Width (px)" }).value).toBe("1200");
    expect(JSON.parse(window.sessionStorage.getItem(FIRST_PROJECT_KEY)!).asked).toBe(false);
  });

  it("starts from the defaults when nothing usable was kept", () => {
    window.sessionStorage.setItem(FIRST_PROJECT_KEY, "{not json");
    render(<NewProjectForm />);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe("My first video");
  });

  it("puts the preview's frame in a box with a definite height", () => {
    // The frame's width comes from its box's height through container units. As a flex-1 item in a column with only a
    // min-height, that box had no definite height and Chrome drew the frame 0 px wide. The preview has a height of its
    // own, and the frame's box is its first grid row.
    const css = readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8");
    const preview = /^\.h-npPreview \{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(preview).toContain("display: grid;");
    expect(preview).toContain("grid-template-rows: minmax(0, 1fr) auto;");
    expect(preview).toMatch(/^\s*height: clamp\(\d+px, [\d.]+vw, \d+px\);$/m);
    expect(preview).not.toContain("min-height");
    const phone = css.slice(css.indexOf("@media (max-width: 860px)"));
    expect(/\.h-npPreview \{\s*height: min\(\d+px, [\d.]+vw\);\s*\}/.test(phone)).toBe(true);
    const { container } = render(<NewProjectForm />);
    const [box, caption] = [...(container.querySelector(".h-npPreview")?.children ?? [])];
    expect(box.querySelector("[data-blank-frame]")).toBeTruthy();
    expect(caption.textContent).toBe("1080 × 1920 px · 30 fps");
  });

  it("shows a still of real footage in the chosen shape, with the name on it as its title", () => {
    const { container } = render(<NewProjectForm />);
    const frame = container.querySelector<HTMLElement>("[data-blank-frame]")!;
    const still = frame.querySelector("img")!;
    expect(still.getAttribute("src")).toMatch(/^\/home\/still-[\w-]+\.webp$/);
    expect(still.getAttribute("alt")).toBe(""); // the preview is a picture; the Name field already says the name
    expect(still.getAttribute("loading")).toBe("lazy");
    expect(frame.style.aspectRatio).toBe("1080 / 1920");
    expect(frame.querySelector(".h-npNameText")?.textContent).toBe("My first video");

    fireEvent.click(screen.getByRole("radio", { name: /Square 1:1/ }));
    expect(frame.style.aspectRatio).toBe("1080 / 1080");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "   " } });
    expect(frame.querySelector(".h-npNameText")?.textContent).toBe("Untitled project");

    const css = readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8");
    const rule = /^\.h-npStill \{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(rule).toContain("object-fit: cover;");
  });

  it("draws the name as a text clip with your selection round it: a blue edge, four handles and your name", () => {
    const { container } = render(<NewProjectForm />);
    const name = container.querySelector<HTMLElement>(".h-npName")!;
    const selection = name.querySelector(".h-npSel")!;
    expect(selection.querySelector(".h-edPeerTag")?.textContent).toBe("You");
    expect([...selection.querySelectorAll(".h-edHandle")].map((h) => h.getAttribute("data-at"))).toEqual(["tl", "tr", "bl", "br"]);
    const rules = cssRules(readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8"));
    const decl = (selector: string, prop: string) =>
      rules.find((r) => r.media === null && r.selectors.includes(selector))?.decls.get(prop);
    expect(decl(".h-npName", "--peer")).toBe("var(--ed-accent)"); // Selection Blue, as your selection is in the editor
    expect(decl(".h-npSel", "outline")).toBe("2px solid var(--peer)");
    expect(decl(".h-npName", "max-width")).toBe("84%");
  });

  it("sets the form at the page's own sizes: what you type and choose at the body size, fields 48 px tall", () => {
    const rules = cssRules(readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8"));
    const decl = (selector: string, prop: string) =>
      rules.find((r) => r.media === null && r.selectors.includes(selector))?.decls.get(prop);
    expect(decl(".h-np", "font-size")).toBe("var(--h-body)");
    expect([decl(".h-npFields input", "height"), decl(".h-npFields input", "font-size")]).toEqual(["48px", "var(--h-body)"]);
    expect(decl(".h-npLabel", "font-size")).toBe("var(--h-small)");
    expect(decl(".h-npFields label > span:first-child", "font-size")).toBe("var(--h-small)");
    expect(decl('.h-npFields [role="radio"] > span:last-child > span:first-child', "font-size")).toBe("var(--h-body)");
    expect(decl('.h-npFields [role="radio"] > span:last-child > span:last-child', "font-size")).toBe("var(--h-small)");
    expect(decl('.h-npFields [role="alert"]', "font-size")).toBe("var(--h-small)");
    // The Format label is the page's, not the dialog's 12 px.
    const { container } = render(<NewProjectForm />);
    const label = container.querySelector(".h-npLabel")!;
    expect([label.textContent, label.className]).toEqual(["Format", "h-npLabel"]);
    // At that size two cards a row would cut the formats' names short on a phone, so there it is one a row.
    const narrow = rules.find((r) => r.media === "@media (max-width: 520px)" && r.selectors.includes('.h-npFields [role="radiogroup"]'));
    expect(narrow?.decls.get("grid-template-columns")).toBe("minmax(0, 1fr)");
  });

  it("ends with Create project as the page's white pill, after the fields and the preview", () => {
    const { container } = render(<NewProjectForm />);
    const create = screen.getByRole("button", { name: "Create project" });
    expect(create.getAttribute("type")).toBe("submit");
    expect(create.className).toBe("h-btn"); // the site's full-size white pill, not the app's small blue button
    const form = container.querySelector("form")!;
    const order = [".h-npFields", ".h-npPreview", ".h-npActions"].map((s) => form.querySelector(s));
    expect([...form.children]).toEqual(order);
    expect(within(order[2] as HTMLElement).getByText("You'll sign in with Google, then it opens in the editor.")).toBeTruthy();
    // No dialog chrome around it any more: the section's heading names it.
    expect(form.querySelector(".h-npHead, .h-npFoot")).toBeNull();
    expect(screen.queryByText("New project")).toBeNull();
    expect(form.getAttribute("aria-label")).toBe("New project");
  });
});

describe("home page agent demo", () => {
  it("starts with Claude's title in Activity, then shows the agent at work and its change for another request", () => {
    vi.useFakeTimers();
    render(<AgentDemo />);
    expect(screen.getByText("Claude (for you) · Added text")).toBeTruthy();

    // The top bar's status holds every agent's words and "Saved" in one spot, and shows the one in use.
    const status = (words: RegExp) => screen.getByText(words).closest(".h-uiStatus > span")!;
    const on = () => [...document.querySelectorAll(".h-uiStatus > [data-on]")].map((s) => s.textContent);
    expect([...document.querySelectorAll(".h-uiStatus > span")].map((s) => s.textContent)).toEqual([
      ...REQUESTS.map((r) => `${r.agent} is editing…`),
      "Saved",
    ]);
    expect(on()).toEqual(["Saved"]);
    expect(status(/^Saved$/).hasAttribute("data-on")).toBe(true);
    expect(status(/Claude is editing/).hasAttribute("data-on")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Make it vertical for Reels and TikTok/ }));
    expect(status(/Codex is editing/).hasAttribute("data-on")).toBe(true);
    expect(status(/^Saved$/).hasAttribute("data-on")).toBe(false);
    expect(on()).toEqual(["Codex is editing…"]);
    // Codex's line already holds its place in Activity, unseen and out of the accessibility tree, while Codex works.
    const line = screen.getByText("Codex (for you) · Changed the format to Vertical 9:16").closest("li")!;
    expect(line.hasAttribute("data-pending")).toBe(true);
    expect(line.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("button", { name: "Undo this change" })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // The same element, now seen: nothing new is put in above the older line when the edit lands.
    expect(screen.getByText("Codex (for you) · Changed the format to Vertical 9:16").closest("li")).toBe(line);
    expect(line.hasAttribute("data-pending")).toBe(false);
    expect(line.hasAttribute("aria-hidden")).toBe(false);
    expect(within(line).getByRole("button", { name: "Undo this change" })).toBeTruthy();
    expect(status(/^Saved$/).hasAttribute("data-on")).toBe(true);
    expect(status(/Codex is editing/).hasAttribute("data-on")).toBe(false);
    expect(screen.getByRole("button", { name: /Make it vertical/ }).getAttribute("aria-pressed")).toBe("true");
    vi.useRealTimers();
  });

  it("keeps every request the same when one is picked, so the one under the pointer stays there", () => {
    vi.useFakeTimers();
    const { container } = render(<AgentDemo />);
    const list = screen.getByRole("list", { name: "Ask an agent" });
    const items = [...list.children];
    const before = items.map((li) => li.innerHTML.replace(/aria-pressed="(true|false)"/, ""));
    fireEvent.click(screen.getByRole("button", { name: /Make the surf shot two seconds long/ }));
    const atClick = [...list.children];
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const landed = [...list.children];
    // The same four elements throughout, each holding only its words and its agent: nothing in the list grows or
    // shrinks with the choice; only aria-pressed (and with it the fill) moves.
    for (const now of [atClick, landed]) {
      expect(now).toEqual(items);
      expect(now.map((li) => li.innerHTML.replace(/aria-pressed="(true|false)"/, ""))).toEqual(before);
    }
    expect(list.querySelectorAll("p, [aria-live]")).toHaveLength(0);
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    vi.useRealTimers();
  });

  it("undoes the agent's change from Activity, and the focus stays on the button", () => {
    render(<AgentDemo />);
    expect(screen.getAllByText("Summer trip").length).toBeGreaterThan(1); // the project name, the title, its clip
    const undo = screen.getByRole("button", { name: "Undo this change" });
    undo.focus();
    fireEvent.click(undo);
    // The same button, still focusable, now says Undone: a disabled button would drop the focus to the page.
    expect(screen.getByRole("button", { name: "Undone" })).toBe(undo);
    expect(undo.hasAttribute("disabled")).toBe(false);
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(undo);
    expect(screen.getAllByText("Summer trip")).toHaveLength(1); // only the project name is left
    fireEvent.click(undo); // pressing it again does nothing
    expect(screen.getByRole("button", { name: "Undone" })).toBe(undo);
    expect(screen.getAllByText("Summer trip")).toHaveLength(1);
  });

  it("says beside the requests what the chosen one's agent did, once its edit has landed", () => {
    vi.useFakeTimers();
    const { container } = render(<AgentDemo />);
    const answer = container.querySelector(".h-demoAnswer")!;
    const live = answer.querySelector(".h-demoResult")!;
    const sizers = () => [...answer.querySelectorAll(".h-demoSizer")];
    // One polite live region, always there, for the chosen request's answer.
    expect([...container.querySelectorAll("[aria-live]")]).toEqual([live]);
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe(
      "Claude adds the text clip. It shows in Activity with Claude's name on it, and Undo takes it back.",
    );
    // Every answer is in the same spot, unseen and hidden from screen readers, holding the space at the longest one's.
    const all = REQUESTS.map((r) => r.result);
    expect(sizers().map((p) => p.textContent)).toEqual(all);
    for (const p of sizers()) expect(p.getAttribute("aria-hidden")).toBe("true");
    // The answer isn't part of the request's name.
    expect(screen.getByRole("button", { name: /Add a title that says Summer trip/ }).textContent).toBe(
      "Add a title that says Summer trip.Ask Claude",
    );

    fireEvent.click(screen.getByRole("button", { name: /Make it vertical/ }));
    // While Codex is at work the live line is empty, so the answer is heard once, when the edit lands, and the
    // unseen answers still hold the space open.
    expect(live.textContent).toBe("");
    expect(sizers().map((p) => p.textContent)).toEqual(all);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(answer.querySelector(".h-demoResult")).toBe(live);
    expect(live.textContent).toBe("Codex changes the format for you. Each agent acts as you, in the space you choose.");
    expect(sizers().map((p) => p.textContent)).toEqual(all);
    vi.useRealTimers();
  });

  it("gives each request a result line with one true fact about agents in EasyEdit", () => {
    expect(REQUESTS.map((r) => [r.agent, r.result])).toEqual([
      ["Claude", "Claude adds the text clip. It shows in Activity with Claude's name on it, and Undo takes it back."],
      ["ChatGPT", "ChatGPT trims the surf clip on the timeline, the same edit you'd make by hand."],
      ["Codex", "Codex changes the format for you. Each agent acts as you, in the space you choose."],
      ["Cursor", "Cursor splits the beach clip in two. Connect as many agents as you like."],
    ]);
  });

  it("keeps the editor's top bar on one line on a narrow phone: the status's words give way, nothing else", () => {
    const { container } = render(<AgentDemo />);
    const bar = container.querySelector(".h-uiBar")!;
    expect([...bar.children].map((k) => k.getAttribute("class"))).toEqual([
      "h-uiLogo",
      "h-uiProject",
      "h-uiStatus",
      "h-uiExport",
    ]);
    // Each agent's words are in a piece of their own, so the dot beside them stays whole when they're cut short.
    for (const line of bar.querySelectorAll(".h-uiStatus > span:not(:last-child)")) {
      expect([...line.children].map((k) => k.className)).toEqual(["h-uiDot", "h-uiStatusText"]);
    }

    const rules = cssRules(readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8"));
    const decl = (selector: string, property: string) =>
      rules.find((r) => r.media === null && r.selectors.includes(selector) && r.decls.has(property))?.decls.get(property);
    for (const fixed of [".h-uiLogo", ".h-uiProject", ".h-uiExport", ".h-uiDot"]) {
      expect(decl(fixed, "flex"), fixed).toBe("none");
    }
    expect(decl(".h-uiProject", "white-space")).toBe("nowrap");
    expect([decl(".h-uiStatus", "min-width"), decl(".h-uiStatus", "grid-template-columns")]).toEqual(["0", "minmax(0, 1fr)"]);
    expect([decl(".h-uiStatusText", "overflow"), decl(".h-uiStatusText", "text-overflow")]).toEqual(["hidden", "ellipsis"]);
  });

  it("marks each agent's edit in that agent's own colour, a different one for each", () => {
    const home = readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8");
    const site = readFileSync(join(process.cwd(), "src/components/site/site.css"), "utf8");
    const tokens: Record<string, string> = { Claude: "--h-claude", ChatGPT: "--h-chatgpt", Codex: "--h-codex", Cursor: "--h-cursor" };
    const values = new Set<string>();
    for (const [agent, token] of Object.entries(tokens)) {
      expect(home, agent).toMatch(new RegExp(`\\.h-ui\\[data-agent="${agent}"\\]\\s*\\{\\s*--fresh:\\s*var\\(${token}\\);`));
      const value = site.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`))?.[1];
      expect(value, token).toBeTruthy();
      values.add(value!);
    }
    // Four agents, four colours, none of them You's blue.
    expect(values.size).toBe(4);
    expect(values.has("#6ea8ff")).toBe(false);
  });

  it("draws the agent's name on a request in the page's own greys, not an accent colour", () => {
    const css = readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8");
    const from = css.indexOf("/* ---------- AI: the live demo");
    const demo = css.slice(from, css.indexOf("/* The drawn editor, in the editor's own"));
    expect(demo).not.toMatch(/--h-accent|--h-claude|#1a1c24/);
    expect(demo).not.toMatch(/box-shadow|border:\s*1px/);
  });

  it("styles the demo so a pick moves nothing and the focus ring goes round the whole request", () => {
    const css = readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8");
    const from = css.indexOf("/* ---------- AI: the live demo");
    const demo = css.slice(from, css.indexOf("/* The drawn editor, in the editor's own"));
    const rule = (sel: string, within = demo) => {
      const at = within.indexOf(`\n${sel} {`);
      expect(at, sel).toBeGreaterThan(-1);
      return within.slice(at, within.indexOf("}", at));
    };
    // The fill is the button's, so the site's focus ring (outside the button) wraps all of it, with nothing of the
    // request under the button for the ring to cross.
    expect(rule(".h-demoRequest")).toMatch(/background: rgb\(255 255 255 \/ 0\.05\)/);
    expect(rule('.h-demoRequest[aria-pressed="true"]')).toMatch(/background: rgb\(255 255 255 \/ 0\.12\)/);
    expect(rule(".h-demoRequests li")).not.toMatch(/background/);
    expect(demo).not.toMatch(/margin(-top)?:\s*-/);
    // Every answer in one grid cell, the unseen ones holding it open.
    expect(rule(".h-demoAnswer")).toMatch(/display: grid/);
    expect(rule(".h-demoAnswer > p")).toMatch(/grid-area: 1 \/ 1/);
    expect(rule(".h-demoSizer")).toMatch(/visibility: hidden/);
    // The agent's Activity line keeps its place while the agent works, and comes in only once the edit lands.
    expect(rule(".h-uiActivity li[data-pending]", css)).toMatch(/visibility: hidden/);
    expect(rule(".h-uiActivity li[data-fresh]:not([data-pending])", css)).toMatch(/animation: h-arrive/);
    // Going vertical cuts the frame's sides away (clip-path) rather than narrowing it, so its box doesn't move.
    expect(rule(".h-uiFrame", css)).toMatch(/clip-path: inset\(0 var\(--cut\)\)/);
    expect(rule(".h-uiFrame[data-vertical]", css)).toMatch(/--cut: calc\(50% - var\(--frame-h, 218px\) \* 9 \/ 32\)/);
    expect(rule(".h-uiFrame[data-vertical]", css)).not.toMatch(/aspect-ratio|width/);
    // In the narrow editor its side panel keeps room for the agent's line at two lines, and shows only that line.
    const narrow = css.slice(css.indexOf("@container (max-width: 520px)"));
    expect(rule("  .h-uiSide", narrow)).toMatch(/min-height: 134px/);
    expect(rule("  .h-uiActivity li:not([data-fresh])", narrow)).toMatch(/display: none/);
    // Two requests a row everywhere.
    expect(rule(".h-demoRequests")).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    // On a computer only the editor and its answer move: to the right column, across all of its rows. The two
    // columns start and end together: the requests sit at the foot of a 1fr last row, and the editor grows to the
    // column's height (its middle row takes the room), with its answer under it at the foot. Nothing is sticky.
    expect(rule(".h-demo")).toMatch(/grid-template-rows: auto auto 1fr;/);
    expect(rule(".h-demo > :not(.h-demoShow)")).toMatch(/grid-column: 1/);
    expect(rule(".h-demoShow")).toMatch(/grid-column: 2;\s*grid-row: 1 \/ -1;\s*display: flex;\s*flex-direction: column;/);
    expect(rule(".h-demoRequests")).toMatch(/align-self: end;/);
    expect(rule(".h-demoStage")).toMatch(/flex: 1;/);
    expect(rule(".h-demoStage > .h-ui")).toMatch(/flex: 1;/);
    expect(rule(".h-uiMain", css)).toMatch(/flex: 1;[\s\S]*min-height: 250px;/);
    expect(demo).not.toMatch(/position: sticky/);
    // Phones: the page's own order, one column, with nothing reordered for the eye that the keyboard would not follow.
    const phone = css.slice(css.indexOf("@media (max-width: 860px)"), css.indexOf("@media (max-width: 520px)"));
    expect(rule("  .h-demo", phone)).toMatch(/grid-template-rows: none/);
    expect(rule("  .h-demoShow", phone)).toMatch(/grid-column: 1;\s*grid-row: auto;/);
    for (const block of [demo, phone]) {
      expect(block).not.toMatch(/\border:\s*-?\d|display: contents|h-demoText/);
    }
  });

  it("keeps the requests, Undo and the pills visible as controls with the system's high contrast colours", () => {
    const home = readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8");
    const site = readFileSync(join(process.cwd(), "src/components/site/site.css"), "utf8");
    const forced = (css: string) =>
      css
        .split("@media (forced-colors: active) {")
        .slice(1)
        .map((b) => b.slice(0, b.indexOf("\n}\n")))
        .join("\n");
    const rule = (sel: string, css: string) => {
      const at = css.indexOf(`\n${sel} {`);
      expect(at, sel).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf("}", at));
    };
    // Every request, Undo, the Pause pill and the first screen's play button get the system's button edge; the chosen
    // request a thicker edge in the selection colour, drawn on top of its own (so it keeps its size), and a used Undo
    // the switched-off colour.
    expect(rule("  .h-demoRequest,\n  .h-uiUndo,\n  .h-pause,\n  .h-edPlay", forced(home))).toMatch(/border: 1px solid ButtonText/);
    const chosen = rule('  .h-demoRequest[aria-pressed="true"]::after', forced(home));
    expect(chosen).toMatch(/position: absolute;\s*inset: -1px;\s*border: 2px solid Highlight/);
    expect(rule("  .h-demoRequest", forced(home))).toMatch(/position: relative/);
    expect(rule('  .h-uiUndo[aria-disabled="true"]', forced(home))).toMatch(/border-color: GrayText;\s*color: GrayText/);
    // The site's pills (here, on sign-in and on the page-not-found page) get an edge in their own text colour.
    expect(rule("  .h-btn", forced(site))).toMatch(/border: 1px solid currentColor/);
    expect(rule("  .h-btn:disabled", forced(site))).toMatch(/border-color: GrayText/);
    // Outside that mode they keep their plain fills.
    expect(rule(".h-demoRequest", home)).toMatch(/border: 0/);
    expect(rule(".h-btn", site)).toMatch(/border: 0/);
  });

  it("offers one request per real agent tool, in the app's own Activity wording", () => {
    expect(REQUESTS.map((r) => r.summary)).toEqual([
      "Added text",
      "Trimmed a video clip",
      "Changed the format to Vertical 9:16",
      "Split a video clip",
    ]);
  });
});

describe("privacy page", () => {
  it("renders signed out with no draft line, and privacy@arush.dev for contact and deletion", () => {
    render(<PrivacyPage />);
    expect(screen.queryByText(/Draft/)).toBeNull();
    expect(document.body.textContent).not.toContain("<your-domain>");
    const mails = screen.getAllByRole("link", { name: "privacy@arush.dev" });
    expect(mails).toHaveLength(2);
    for (const a of mails) expect(a.getAttribute("href")).toBe("mailto:privacy@arush.dev");
    expect(document.body.textContent).toContain("drive.file");
  });

  it("links to the terms of service", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("link", { name: "terms of service" }).getAttribute("href")).toBe("/terms");
  });

  it("says where the media is kept, in its own words", () => {
    render(<PrivacyPage />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("stored in the Google Drive the space uses, not on EasyEdit's own servers");
    expect(text).toContain("keeps its media in a folder of its own shared drive that it shared with EasyEdit instead. There, EasyEdit can see only that folder.");
    expect(text).not.toContain("Seattle Solvers");
  });
});

describe("terms page", () => {
  it("renders signed out with its date, the rules and a link back to /privacy", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Terms of service" })).toBeTruthy();
    expect(screen.getByText("Last updated November 17, 2026.")).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).toContain("at least 13");
    expect(text).toContain("You keep ownership");
    expect(text).toContain("provided as is");
    expect(screen.getByRole("link", { name: "privacy page" }).getAttribute("href")).toBe("/privacy");
    const article = within(document.querySelector("article")!);
    expect(article.getByRole("link", { name: "help@arush.dev" }).getAttribute("href")).toBe("mailto:help@arush.dev");
    expect(screen.queryByText(/Draft/)).toBeNull();
  });
});
