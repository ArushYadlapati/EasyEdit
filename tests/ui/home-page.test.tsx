// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import PrivacyPage from "@/app/privacy/page";
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
  it("signed out shows the pitch, a link to /login and a link to /privacy", async () => {
    render(await Home());
    expect(screen.getByText("Edit short videos with your team, and with AI agents.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continue with Google" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
  });

  it("signed in goes to the dashboard", async () => {
    signedIn.user = ada;
    await expect(Home()).rejects.toMatchObject({ to: "/dashboard" });
  });
});

describe("privacy page", () => {
  it("renders signed out with the draft line and the contact placeholder", () => {
    render(<PrivacyPage />);
    expect(screen.getByText("Draft — not yet reviewed.")).toBeTruthy();
    expect(screen.getByText(/privacy@<your-domain>/)).toBeTruthy();
    expect(document.body.textContent).toContain("drive.file");
  });

  it("says media is in the Google Drive the space uses, which for Seattle Solvers is the team's shared drive", () => {
    render(<PrivacyPage />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("stored in the Google Drive the space uses");
    expect(text).toContain("For Seattle Solvers, that is the team's shared drive.");
    expect(text).not.toContain("the Google Drive you connect");
  });
});
