// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { AgentDemo, REQUESTS } from "@/components/home/agent-demo";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import type { CurrentUser } from "@/lib/access-rules";
import { act, fireEvent, render, screen } from "../helpers/dom";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
const { signedIn } = vi.hoisted(() => ({ signedIn: { user: null as CurrentUser | null } }));
vi.mock("@/lib/access", () => ({ getCurrentUser: vi.fn(async () => signedIn.user) }));
// The home page's font is a next/font loader, which only runs in a Next build.
vi.mock("@/components/home/erode", () => ({ erode: { variable: "font-erode" } }));

const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };

beforeEach(() => {
  signedIn.user = null;
});

describe("home page", () => {
  it("signed out shows the pitch, the start button to /login, and links to /privacy and /terms", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    render(await Home());
    vi.unstubAllEnvs();
    expect(screen.getByRole("heading", { level: 1, name: "Edit videos with your team and AI" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start editing, free" }).getAttribute("href")).toBe("/login");
    for (const a of screen.getAllByRole("link", { name: "Sign in" })) expect(a.getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
  });

  it("has a section for AI agents, teams and the editor, each linked from the first screen", async () => {
    render(await Home());
    for (const [name, id] of [
      ["AI agents", "ai"],
      ["Teams", "team"],
      ["The editor", "tools"],
    ]) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(`#${id}`);
      expect(document.getElementById(id)).toBeTruthy();
    }
  });

  it("says EasyEdit is free, as the terms do", async () => {
    render(await Home());
    expect(screen.getByText("Nothing. EasyEdit is free.")).toBeTruthy();
  });

  it("says EasyEdit is in closed beta while sign-up is closed, and the button just signs in", async () => {
    vi.stubEnv("OPEN_SIGNUP", "");
    render(await Home());
    expect(screen.getByText("EasyEdit is in closed beta. Sign-in is by invitation only for now.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Start editing, free" })).toBeNull();
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
    expect(screen.getAllByText("Spring showcase").length).toBeGreaterThan(1); // the project name, the title, its clip
    fireEvent.click(screen.getByRole("button", { name: "Undo this change" }));
    expect(screen.getByRole("button", { name: "Undone" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("Spring showcase")).toHaveLength(1); // only the project name is left
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
    expect(screen.getByText("Last updated November 15, 2026.")).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).toContain("at least 13");
    expect(text).toContain("You keep ownership");
    expect(text).toContain("provided as is");
    expect(screen.getByRole("link", { name: "privacy page" }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: "help@arush.dev" }).getAttribute("href")).toBe("mailto:help@arush.dev");
    expect(screen.queryByText(/Draft/)).toBeNull();
  });
});
