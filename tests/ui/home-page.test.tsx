// @vitest-environment happy-dom
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { AgentDemo, REQUESTS } from "@/components/home/agent-demo";
import { NewProjectForm } from "@/components/home/new-project-form";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import type { CurrentUser } from "@/lib/access-rules";
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
    // One name for the one action, in the header and in the first screen.
    const starts = screen.getAllByRole("link", { name: "Start free" });
    expect(starts).toHaveLength(2);
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
    expect(track.querySelectorAll(".h-agent")).toHaveLength(16); // the row twice, so the loop has no seam
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
    expect(document.getElementById("free")?.textContent).toContain("Based in your Drive.");
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
    // The end of the page is marked for the dock, which goes down while it is in view. It is the end of the last
    // section: marked anywhere higher up, the dock would go down in the middle of the page. The new project form,
    // higher up the page now, no longer carries it.
    const ends = [...main.querySelectorAll("[data-dock-end]")];
    expect(ends).toHaveLength(1);
    expect(sections.at(-1)!.contains(ends[0])).toBe(true);
    expect(document.querySelector("form")?.closest("[data-dock-end]")).toBeNull();
    expect(document.querySelector("form [data-dock-end]")).toBeNull();
    const afterIt = [...sections.at(-1)!.querySelectorAll("*")].filter(
      (el) => ends[0].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !ends[0].contains(el),
    );
    expect(afterIt).toEqual([]);
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
    expect(sections.map((el) => el.id)).toEqual(["ai", "start", "free", "teams", "agents"]);
    const names = sections.map((el) => within(el as HTMLElement).getAllByRole("heading", { level: 2 })[0]);
    expect(names.map((h) => h.textContent)).toEqual([
      "Ask an agent. Watch it edit.",
      "Make your first project.",
      "Completely free. Based in your Drive.",
      "Built for teams.",
      "Works with every AI agent.",
    ]);
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
    // The order a phone shows them in, one under the other; a computer only moves the editor to a column of its own.
    const demo = heading.parentElement!;
    expect(demo.classList.contains("h-demo")).toBe(true);
    expect([...demo.children].map((el) => el.tagName)).toEqual(["H2", "P", "FIGURE", "DIV", "UL"]);
    expect([...demo.children].slice(2)).toEqual([stage, demo.querySelector(".h-demoAnswer"), requests]);
    expect(ai.querySelector(".h-demoText, .h-sectionHead, .h-points, h3")).toBeNull();
    // The old three points live on as the requests' own result lines.
    for (const gone of ["Plain words in, real edits out", "Signed and undoable", "It works as you"]) {
      expect(ai.textContent).not.toContain(gone);
    }
    expect(stage.querySelector(":scope > [data-ui]")).toBeTruthy();
    expect(stage.querySelector("figcaption")).toBeNull();
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

describe("home page new project form", () => {
  beforeEach(() => push.mockClear());

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

  it("Create project goes to sign in", () => {
    render(<NewProjectForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(push).toHaveBeenCalledWith("/login");
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
    expect(frame.querySelector(".h-npName")?.textContent).toBe("My first video");

    fireEvent.click(screen.getByRole("radio", { name: /Square 1:1/ }));
    expect(frame.style.aspectRatio).toBe("1080 / 1080");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "   " } });
    expect(frame.querySelector(".h-npName")?.textContent).toBe("Untitled project");

    const css = readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8");
    const rule = /^\.h-npStill \{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(rule).toContain("object-fit: cover;");
  });

  it("ends with Create project as the page's white pill, after the fields and the preview", () => {
    const { container } = render(<NewProjectForm />);
    const create = screen.getByRole("button", { name: "Create project" });
    expect(create.getAttribute("type")).toBe("submit");
    expect(create.className).toBe("h-btn"); // the site's full-size white pill, not the app's small blue button
    const form = container.querySelector("form")!;
    const order = [".h-npFields", ".h-npPreview", ".h-npActions"].map((s) => form.querySelector(s));
    expect([...form.children]).toEqual(order);
    expect(within(order[2] as HTMLElement).getByText("You'll sign in with Google first.")).toBeTruthy();
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

    // The top bar's status holds both of its words in one spot, and shows the one in use.
    const status = (words: RegExp) => screen.getByText(words).closest(".h-uiStatus > span")!;
    expect(status(/^Saved$/).hasAttribute("data-on")).toBe(true);
    expect(status(/Claude is editing/).hasAttribute("data-on")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Make it vertical for Reels and TikTok/ }));
    expect(status(/Codex is editing/).hasAttribute("data-on")).toBe(true);
    expect(status(/^Saved$/).hasAttribute("data-on")).toBe(false);
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
    // Two requests a row everywhere, so the answer is never more than a row from the one it answers.
    expect(rule(".h-demoRequests")).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    // On a computer only the editor moves: to the right column, across all of its rows, with a last row that takes
    // up its height if it is ever the taller. The rest stay in the page's order down the left column.
    expect(rule(".h-demo")).toMatch(/grid-template-rows: repeat\(4, auto\) 1fr/);
    expect(rule(".h-demo > :not(.h-demoStage)")).toMatch(/grid-column: 1/);
    expect(rule(".h-demoStage")).toMatch(/grid-column: 2;\s*grid-row: 1 \/ -1;\s*position: sticky/);
    // Phones: the page's own order, one column, with nothing reordered for the eye that the keyboard would not follow.
    const phone = css.slice(css.indexOf("@media (max-width: 860px)"), css.indexOf("@media (max-width: 380px)"));
    expect(rule("  .h-demo", phone)).toMatch(/grid-template-rows: none/);
    expect(rule("  .h-demoStage", phone)).toMatch(/grid-column: 1;\s*grid-row: auto;\s*position: static/);
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
    // Every request, Undo and the Pause pills get the system's button edge; the chosen request a thicker edge in the
    // selection colour, drawn on top of its own (so it keeps its size), and a used Undo the switched-off colour.
    expect(rule("  .h-demoRequest,\n  .h-uiUndo,\n  .h-pause", forced(home))).toMatch(/border: 1px solid ButtonText/);
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

  it("says media is in the Google Drive the space uses, which for Seattle Solvers is the team's shared drive", () => {
    render(<PrivacyPage />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("stored in the Google Drive the space uses");
    expect(text).toContain("For Seattle Solvers, that is the team's shared drive.");
    expect(text).not.toContain("the Google Drive you connect");
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
