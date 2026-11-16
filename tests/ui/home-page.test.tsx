// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import type { CurrentUser } from "@/lib/access-rules";
import { render, screen } from "../helpers/dom";

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

const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };

beforeEach(() => {
  signedIn.user = null;
});

describe("home page", () => {
  it("signed out shows the pitch, a link to /login, a link to /privacy and a link to /terms", async () => {
    render(await Home());
    expect(screen.getByText("Edit short videos with your team, and with AI agents.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
  });

  it("says EasyEdit is in closed beta while sign-up is closed", async () => {
    vi.stubEnv("OPEN_SIGNUP", "");
    render(await Home());
    expect(screen.getByText("Closed beta")).toBeTruthy();
    expect(screen.getByText("Sign-in is by invitation only for now.")).toBeTruthy();
    vi.unstubAllEnvs();
  });

  it("drops the closed beta note once sign-up is open", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    render(await Home());
    expect(screen.queryByText("Closed beta")).toBeNull();
    expect(screen.queryByText(/by invitation only/)).toBeNull();
    vi.unstubAllEnvs();
  });

  it("signed in goes to the dashboard", async () => {
    signedIn.user = ada;
    await expect(Home()).rejects.toMatchObject({ to: "/dashboard" });
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
