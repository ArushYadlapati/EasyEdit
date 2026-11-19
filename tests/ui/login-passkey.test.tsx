// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import LoginPage, { metadata as loginMetadata } from "@/app/(auth)/login/page";
import { PasskeySignInButton } from "@/app/(auth)/login/passkey-sign-in-button";
import { cssRules } from "../helpers/css-rules";
import { act, fireEvent, render, screen, waitFor } from "../helpers/dom";

type SignInResult = {
  data: unknown;
  error: { code?: string; message?: string; status: number; statusText: string } | null;
};
const passkey = vi.hoisted(() => vi.fn(async (): Promise<SignInResult> => ({ data: null, error: null })));
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { passkey } } }));
// For rendering the whole login page to a signed-out visitor.
vi.mock("@/lib/access", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/env", () => ({ requiredEnv: () => "test-secret" }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));

// What signIn.passkey() returns when the browser's passkey sheet is closed (NotAllowedError, through SimpleWebAuthn).
const CANCELLED = {
  code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
  message: "Auth cancelled",
  status: 400,
  statusText: "BAD_REQUEST",
};
const SIGNED_IN = { session: { id: "s1" }, user: { id: "u1" } };

let assign: MockInstance<(url: string | URL) => void>;
beforeEach(() => {
  passkey.mockReset();
  vi.stubGlobal("PublicKeyCredential", class PublicKeyCredential {});
  assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockRestore();
});

const button = () => screen.getByRole<HTMLButtonElement>("button", { name: "Sign in with a passkey" });

// Lets a sign-in the mock has already answered finish in the component.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function signInAnswers(result: SignInResult) {
  passkey.mockResolvedValueOnce(result);
  render(<PasskeySignInButton />);
  fireEvent.click(button());
}

describe("the login page", () => {
  type Page = (props: { params: Promise<object>; searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>;

  it("offers Google, then a passkey, and no field to type in", async () => {
    const page: Page = LoginPage;
    render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    // The sign-in's own buttons (the picture beside it has only its Pause).
    const signIn = screen.getByRole("heading", { level: 1, name: "Sign in" }).parentElement!;
    expect(Array.from(signIn.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "Sign in with Google",
      "Sign in with a passkey",
    ]);
    expect(document.querySelector("input, textarea, select")).toBeNull();
  });

  it("with sign-up closed, says sign-in is by invitation, and the header offers no Start free", async () => {
    vi.stubEnv("OPEN_SIGNUP", "");
    const page: Page = LoginPage;
    render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    vi.unstubAllEnvs();
    expect(screen.getByText("EasyEdit is in closed beta. Sign-in is by invitation only for now.").className).toBe("h-plainLead");
    expect(screen.queryByText(/Sign in or create an account with Google\./)).toBeNull();
    expect(screen.queryByRole("link", { name: "Start free" })).toBeNull();
    for (const a of screen.getAllByRole("link", { name: "Sign in" })) expect(a.getAttribute("href")).toBe("/login");
  });

  it("sets both buttons as the site's pills: white for Google, the quieter tint for a passkey", async () => {
    const page: Page = LoginPage;
    render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    const google = screen.getByRole("button", { name: "Sign in with Google" });
    expect(google.className.split(/\s+/)).toEqual(["h-btn", "w-full"]);
    expect(button().className.split(/\s+/)).toEqual(["h-btn", "h-btnGhost", "w-full"]);
  });

  it("says a refused sign-in in the danger colour, with no box behind it", async () => {
    const page: Page = LoginPage;
    render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({ error: "NOT_ALLOWLISTED" }) }));
    const alert = screen.getByRole("alert");
    expect(alert.className).toBe("text-base font-medium text-danger text-pretty");
  });
});

describe("the login page with sign-up open", () => {
  type Page = (props: { params: Promise<object>; searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
  afterEach(() => vi.unstubAllEnvs());

  it("says Google creates an account too, in the page's lead line under a real title", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    const page: Page = LoginPage;
    render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    const line = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Sign in or create an account with Google. EasyEdit is free.");
    expect(line.className.split(/\s+/)).toContain("h-plainLead");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Sign in");
    expect(heading.className).toBe("h-plainTitle");
    expect(screen.queryByText(/closed beta/)).toBeNull();
  });

  it("says what Google shares before its screen asks, with the privacy page a click away", async () => {
    const page: Page = LoginPage;
    render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    const note = screen.getByText(/Google shares your name, email address and profile picture with EasyEdit\./);
    expect(note.textContent).toContain("EasyEdit only ever sees the files it makes there.");
    expect(note.className).toBe("h-signNote");
    const link = screen.getByRole("link", { name: "How EasyEdit uses your data" });
    expect(link.getAttribute("href")).toBe("/privacy");
  });

  it("draws the editor beside the sign-in as a picture, out of the screen reader's way", async () => {
    const page: Page = LoginPage;
    const { container } = render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    const picture = container.querySelector(".h-signPicture")!;
    expect(picture.hasAttribute("data-ui")).toBe(true);
    // Its bar and preview are hidden from screen readers; the timeline's controls are not.
    expect(picture.querySelector(".h-signBar")!.getAttribute("aria-hidden")).toBe("true");
    expect(picture.querySelector(".h-signStage")!.getAttribute("aria-hidden")).toBe("true");
    // The ocean on a loop: muted, inline, with its still as the poster.
    const clip = picture.querySelector("video")!;
    expect(clip.getAttribute("src")).toBe("/home/scene-wave.mp4");
    expect(clip.getAttribute("poster")).toBe("/home/scene-wave.webp");
    expect([clip.muted, clip.loop, clip.hasAttribute("playsinline")]).toEqual([true, true, true]);
    expect(picture.textContent).toContain("Your next video");
    expect(picture.querySelector(".h-signTag")!.textContent).toBe("Codex");
    const css = readFileSync(join(process.cwd(), "src/components/site/site.css"), "utf8");
    expect(css).toMatch(/\.h-signTitle \{\s*--peer: var\(--h-codex\);/);
    // The sign-in comes first in the page, then the picture.
    const main = screen.getByRole("main");
    expect(main.lastElementChild).toBe(picture.parentElement);
  });

  it("plays the ocean on its own, with the editor's play/pause button at the start of its timeline", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    const page: Page = LoginPage;
    const { container } = render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    const button = await screen.findByRole("button", { name: "Pause the ocean video" });
    expect(play).toHaveBeenCalled();
    expect(button.closest(".h-signTimeline")).not.toBeNull();
    expect(button.closest("[aria-hidden]")).toBeNull();
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    // The floating pill is gone: the timeline's button is the only one in the picture.
    expect(container.querySelector(".h-signPause")).toBeNull();
    expect(container.querySelector(".h-signPictureCell")!.querySelectorAll("button")).toHaveLength(1);
    act(() => button.click());
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play the ocean video" })).toBe(button);
  });

  it("lets the playhead be dragged, or the timeline clicked, to any moment, and moved with the keys", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    const page: Page = LoginPage;
    const { container } = render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    const scrub = screen.getByRole("slider", { name: "Moment in the ocean video" });
    expect(scrub.closest("[aria-hidden]")).toBeNull();
    expect(scrub.getAttribute("aria-valuemin")).toBe("0");
    expect(scrub.getAttribute("aria-valuemax")).toBe("6");
    const clip = container.querySelector("video")!;
    vi.spyOn(scrub, "getBoundingClientRect").mockReturnValue({ left: 100, width: 600, top: 0, height: 100, right: 700, bottom: 100, x: 100, y: 0, toJSON() {} } as DOMRect);
    scrub.setPointerCapture = () => {};
    scrub.hasPointerCapture = () => true;
    // Halfway along the timeline is halfway through the six seconds.
    fireEvent.pointerDown(scrub, { button: 0, clientX: 400, pointerId: 1 });
    expect(clip.currentTime).toBeCloseTo(3);
    expect(scrub.getAttribute("aria-valuetext")).toBe("0:03 of 0:06");
    fireEvent.pointerMove(scrub, { clientX: 500, pointerId: 1 });
    expect(clip.currentTime).toBeCloseTo(4);
    fireEvent.keyDown(scrub, { key: "ArrowLeft" });
    expect(clip.currentTime).toBeCloseTo(3.5);
    fireEvent.keyDown(scrub, { key: "Home" });
    expect(clip.currentTime).toBe(0);
    fireEvent.keyDown(scrub, { key: "End" });
    expect(clip.currentTime).toBeCloseTo(6);
    // The timeline shows the clip's six seconds, a title on the text track and the clip on the video track.
    const ruler = container.querySelector(".h-signRuler")!;
    expect(Array.from(ruler.children).map((c) => c.textContent)).toEqual(["0:00", "0:01", "0:02", "0:03", "0:04", "0:05", "0:06"]);
    expect(container.querySelector(".h-signClipText")!.textContent).toBe("Your next video");
    expect(Array.from(container.querySelectorAll(".h-signTrackName")).map((n) => n.textContent)).toEqual(["Text 1", "Video 1"]);
  });

  it("doesn't start the ocean by itself when reduced motion is asked for, but Play still plays it", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const page: Page = LoginPage;
    const { container } = render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    await act(async () => {});
    expect(play).not.toHaveBeenCalled();
    expect(container.querySelector("video")!.getAttribute("preload")).toBe("metadata");
    const button = screen.getByRole("button", { name: "Play the ocean video" });
    act(() => button.click());
    expect(play).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause the ocean video" })).toBe(button);
  });

  it("is no dead end: the site's header leads home, with the footer under the page", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    const page: Page = LoginPage;
    render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: "EasyEdit home" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("banner").closest("main")).toBeNull();
    expect(screen.getByRole("contentinfo").closest("main")).toBeNull();
  });

  it("leaves out the header's Sign in and Start free, which only lead back to this page, and marks it in the footer", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    const page: Page = LoginPage;
    render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    const header = screen.getByRole("banner");
    expect([...header.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["EasyEdit", "/"],
      ["AI agents", "/#ai"],
      ["Free", "/#free"],
      ["Teams", "/#teams"],
    ]);
    expect(screen.queryByRole("link", { name: "Start free" })).toBeNull();
    // One white pill on the page: Google's.
    expect([...document.querySelectorAll(".h-btn:not(.h-btnGhost)")].map((el) => el.textContent)).toEqual(["Sign in with Google"]);
    const footerSignIn = screen.getByRole("link", { name: "Sign in" });
    expect(footerSignIn.closest("footer")).toBe(screen.getByRole("contentinfo"));
    expect(footerSignIn.getAttribute("aria-current")).toBe("page");
  });

  it("an unverified Google email is told so, not about the allowlist", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    const page: Page = LoginPage;
    render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({ error: "NOT_ALLOWLISTED" }) }));
    expect(screen.getByRole("alert").textContent).toBe("Google hasn't verified that email address, so EasyEdit can't use it to sign in.");
  });

  it("names its tab as the site's other pages do", () => {
    expect(loginMetadata.title).toBe("Sign in · EasyEdit");
  });

  it("sets an error in the site's body size, like the rest of the page's words, Google's and the passkey's alike", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    passkey.mockResolvedValueOnce({ data: null, error: { code: "PASSKEY_NOT_FOUND", status: 404, statusText: "NOT_FOUND" } });
    const page: Page = LoginPage;
    render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({ error: "NOT_ALLOWLISTED" }) }));
    fireEvent.click(button());
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    // Both errors sit in the page's column, where site.css sets them at 17 px instead of the shared class's 16 px.
    for (const alert of screen.getAllByRole("alert")) expect(alert.closest(".h-plainColumn")).not.toBeNull();
    const css = readFileSync(join(process.cwd(), "src/components/site/site.css"), "utf8");
    const rule = cssRules(css).find((r) => r.media === null && r.selectors.includes('.h-plainColumn [role="alert"]'));
    expect(rule?.decls.get("font-size")).toBe("17px");
    expect(cssRules(css).find((r) => r.selectors.includes(".h-site"))?.decls.get("font-size")).toBe("17px");
  });

  it("the passkey button is told the same", async () => {
    passkey.mockResolvedValueOnce({ data: null, error: { code: "NOT_ALLOWLISTED", message: "NOT_ALLOWLISTED", status: 403, statusText: "FORBIDDEN" } });
    render(<PasskeySignInButton openSignUp />);
    fireEvent.click(button());
    expect((await screen.findByRole("alert")).textContent).toBe("Google hasn't verified that email address, so EasyEdit can't use it to sign in.");
  });
});

describe("the passkey sign-in button", () => {
  it("reads Sign in with a passkey and is a light tint, not filled white like the Google button nor outlined", () => {
    render(<PasskeySignInButton />);
    const classes = button().className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["h-11", "w-full", "rounded-full", "bg-foreground/15"]));
    expect(classes).not.toContain("bg-foreground");
    expect(classes).not.toContain("border");
    expect(button().disabled).toBe(false);
  });

  it("takes the look the page gives it", () => {
    render(<PasskeySignInButton className="h-btn h-btnGhost w-full" />);
    expect(button().className).toBe("h-btn h-btnGhost w-full");
  });

  it("isn't shown in a browser without passkeys", () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    render(<PasskeySignInButton />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sends one sign-in at a time and stays disabled until it settles", async () => {
    let answer!: (result: SignInResult) => void;
    passkey.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    render(<PasskeySignInButton />);
    fireEvent.click(button());
    expect(button().disabled).toBe(true);
    fireEvent.click(button());
    expect(passkey).toHaveBeenCalledTimes(1);
    answer({ data: null, error: CANCELLED });
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(passkey).toHaveBeenCalledTimes(1);
  });

  it("a cancelled passkey sheet shows nothing and the button works again", async () => {
    signInAnswers({ data: null, error: CANCELLED });
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    passkey.mockResolvedValueOnce({ data: null, error: CANCELLED });
    fireEvent.click(button());
    expect(passkey).toHaveBeenCalledTimes(2);
  });

  it("an account not on the allowlist is told so", async () => {
    signInAnswers({
      data: null,
      error: { code: "NOT_ALLOWLISTED", message: "NOT_ALLOWLISTED", status: 403, statusText: "FORBIDDEN" },
    });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This account doesn't have access to EasyEdit. If you were invited, sign in with the Google account the invite was sent to.",
    );
    expect(button().disabled).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("a passkey EasyEdit doesn't know says how to add one", async () => {
    signInAnswers({
      data: null,
      error: { code: "PASSKEY_NOT_FOUND", message: "Passkey not found", status: 401, statusText: "UNAUTHORIZED" },
    });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That passkey isn't set up for EasyEdit. Sign in with Google, then add a passkey from your account menu.",
    );
  });

  it("a passkey approved in the sheet whose check got no answer says it didn't finish", async () => {
    // The passkey client's answer when its request to verify-authentication throws, as on a dropped connection.
    signInAnswers({ data: null, error: { code: "AUTH_CANCELLED", message: "Auth cancelled", status: 400, statusText: "BAD_REQUEST" } });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Passkey sign-in didn't finish. Try again, or sign in with Google.",
    );
    expect(button().disabled).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("a sign-in that throws says it didn't finish, and trying again clears the message", async () => {
    passkey.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<PasskeySignInButton />);
    fireEvent.click(button());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Passkey sign-in didn't finish. Try again, or sign in with Google.",
    );
    expect(button().disabled).toBe(false);
    passkey.mockResolvedValueOnce({ data: null, error: CANCELLED });
    fireEvent.click(button());
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("while connecting Claude, leaves the sign-in server's redirect to the auth client", async () => {
    signInAnswers({ data: { redirect: true, url: "http://localhost:3000/consent?client_id=c1" }, error: null });
    await settle();
    expect(passkey).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
    // Stays disabled while the browser leaves.
    expect(button().disabled).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an ordinary sign-in goes to the dashboard", async () => {
    signInAnswers({ data: SIGNED_IN, error: null });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/dashboard"));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(button().disabled).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
