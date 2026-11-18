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
import { act, fireEvent, render, screen } from "../helpers/dom";

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

describe("home page", () => {
  it("signed out shows the headline, the start buttons to /login, and links to /privacy and /terms", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    render(await Home());
    vi.unstubAllEnvs();
    expect(screen.getByRole("heading", { level: 1, name: "The video editor for AI agents, teams and creators, in your browser" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start editing, free" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Start free" }).getAttribute("href")).toBe("/login");
    for (const a of screen.getAllByRole("link", { name: "Sign in" })) expect(a.getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
  });

  it("changes the headline's ending every few seconds: for AI agents, for teams, for creators, in your browser", async () => {
    vi.useFakeTimers();
    render(await Home());
    const phrase = () => document.querySelector(".h-heroPhrase [data-on]")?.textContent;
    expect(phrase()).toBe("for AI agents.");
    for (const next of ["for teams.", "for creators.", "in your browser.", "for AI agents."]) {
      act(() => {
        vi.advanceTimersByTime(9000); // each scene lasts 4 to 8.5 seconds
      });
      expect(phrase()).toBe(next);
    }
    vi.useRealTimers();
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
    expect(document.querySelector(".h-heroPhrase [data-on]")?.textContent).toBe("for creators.");
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
    expect(document.querySelector(".h-heroPhrase [data-on]")?.textContent).toBe("for AI agents.");

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

  it("has the AI, team and get-started sections, linked from the top, and no tools section", async () => {
    render(await Home());
    for (const [name, id] of [
      ["AI agents", "ai"],
      ["Teams", "teams"],
      ["Get started", "start"],
    ]) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(`#${id}`);
      expect(document.getElementById(id)).toBeTruthy();
    }
    expect(document.getElementById("tools")).toBeNull();
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

  it("says it works with every AI agent inside the AI section, that it's completely free, then offers the first project", async () => {
    render(await Home());
    expect(document.getElementById("ai")?.textContent).toContain("Works with every AI agent.");
    expect(screen.getByRole("heading", { level: 2, name: "Completely free. Based in your Drive." })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Works with every AI agent." })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Make your first project." })).toBeTruthy();
  });

  it("says EasyEdit is in closed beta while sign-up is closed, and the buttons just sign in", async () => {
    vi.stubEnv("OPEN_SIGNUP", "");
    render(await Home());
    expect(screen.getByText("EasyEdit is in closed beta. Sign-in is by invitation only for now.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Start editing, free" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Start free" })).toBeNull();
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
});

describe("home page agent demo", () => {
  it("starts with Claude's title in Activity, then shows the agent at work and its change for another request", () => {
    vi.useFakeTimers();
    render(<AgentDemo />);
    expect(screen.getByText("Claude (for you) · Added text")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Make it vertical for Reels and TikTok/ }));
    expect(screen.getByText(/Codex is editing/)).toBeTruthy();
    expect(screen.queryByText(/Codex \(for you\)/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Codex (for you) · Changed the format to Vertical 9:16")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Make it vertical/ }).getAttribute("aria-pressed")).toBe("true");
    vi.useRealTimers();
  });

  it("undoes the agent's change from Activity", () => {
    render(<AgentDemo />);
    expect(screen.getAllByText("Summer trip").length).toBeGreaterThan(1); // the project name, the title, its clip
    fireEvent.click(screen.getByRole("button", { name: "Undo this change" }));
    expect(screen.getByRole("button", { name: "Undone" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("Summer trip")).toHaveLength(1); // only the project name is left
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
    expect(screen.getByRole("link", { name: "help@arush.dev" }).getAttribute("href")).toBe("mailto:help@arush.dev");
    expect(screen.queryByText(/Draft/)).toBeNull();
  });
});
