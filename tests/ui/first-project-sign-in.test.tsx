// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import LoginPage from "@/app/(auth)/login/page";
import { PasskeySignInButton } from "@/app/(auth)/login/passkey-sign-in-button";
import NewProjectPage from "@/app/new/page";
import { StartProject } from "@/app/new/start-project";
import type { CurrentUser } from "@/lib/access-rules";
import { FIRST_PROJECT_KEY } from "@/lib/home/first-project";
import { fireEvent, render, screen, waitFor } from "../helpers/dom";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}
const { replace, social, passkey, signedIn } = vi.hoisted(() => ({
  replace: vi.fn(),
  social: vi.fn(async (_: unknown) => ({ error: null })),
  passkey: vi.fn(async () => ({ data: null, error: null })),
  signedIn: { user: null as CurrentUser | null },
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  useRouter: () => ({ replace, push: vi.fn() }),
  unstable_rethrow: () => {},
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { social, passkey } } }));
vi.mock("@/lib/access", () => ({ getCurrentUser: async () => signedIn.user, requireUser: async () => signedIn.user }));
vi.mock("@/lib/env", () => ({ requiredEnv: () => "test-secret" }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));

const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };
type Page = (props: { params: Promise<object>; searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const login = (query: Record<string, string>) => (LoginPage as Page)({ params: Promise.resolve({}), searchParams: Promise.resolve(query) });

let assign: MockInstance<(url: string | URL) => void>;
beforeEach(() => {
  signedIn.user = null;
  replace.mockClear();
  social.mockClear();
  window.sessionStorage.clear();
  vi.stubGlobal("PublicKeyCredential", class PublicKeyCredential {});
  assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockRestore();
});

describe("signing in on the way to a new project", () => {
  it("Google comes back to next, and to the sign-in page with next if it fails", async () => {
    render(await login({ next: "/new" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(social).toHaveBeenCalledWith({ provider: "google", callbackURL: "/new", errorCallbackURL: "/login?next=%2Fnew" });
  });

  it("says the project opens once signed in", async () => {
    render(await login({ next: "/new" }));
    expect(screen.getByText("Sign in, and your project opens in the editor.").className.split(" ")).toContain("h-plainInk");
  });

  it("ignores a next on another site, and goes to the dashboard as before", async () => {
    render(await login({ next: "//evil.example/new" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(social).toHaveBeenCalledWith({ provider: "google", callbackURL: "/dashboard", errorCallbackURL: "/login" });
    expect(screen.queryByText(/your project opens/)).toBeNull();
  });

  it("someone already signed in goes straight on to next", async () => {
    signedIn.user = ada;
    await expect(login({ next: "/new" })).rejects.toThrow("REDIRECT /new");
    await expect(login({ next: "https://evil.example" })).rejects.toThrow("REDIRECT /dashboard");
  });

  it("a passkey goes on to next too", async () => {
    passkey.mockResolvedValueOnce({ data: { session: {} }, error: null } as never);
    render(<PasskeySignInButton next="/new" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/new"));
  });
});

describe("the new project page", () => {
  const ask = (asked: boolean) =>
    window.sessionStorage.setItem(
      FIRST_PROJECT_KEY,
      JSON.stringify({ name: "Beach day recap", format: "long_16x9", width: "1080", height: "1080", asked }),
    );

  it("sends a signed-out visitor to sign in, on the way back here", async () => {
    await expect(NewProjectPage()).rejects.toThrow("REDIRECT /login?next=%2Fnew");
  });

  it("makes the project the home page asked for, once, with what was typed", async () => {
    ask(true);
    const action = vi.fn(async (_: FormData) => ({}));
    render(<StartProject action={action} />);
    expect(screen.getByRole("heading", { name: "Making your project" })).toBeTruthy();
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(action.mock.calls[0][0].entries())).toEqual({ name: "Beach day recap", format: "long_16x9" });
    await waitFor(() => expect(window.sessionStorage.getItem(FIRST_PROJECT_KEY)).toBeNull());
    expect(replace).not.toHaveBeenCalled();
  });

  it("goes on to the dashboard when nothing was asked for in this tab, as from a link elsewhere", async () => {
    ask(false);
    const action = vi.fn(async (_: FormData) => ({}));
    render(<StartProject action={action} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(action).not.toHaveBeenCalled();
  });

  it("says why when the project can't be made, with a way on, and asks no second time by itself", async () => {
    ask(true);
    const action = vi.fn(async (_: FormData) => ({ error: "You've made 25 projects today." }));
    render(<StartProject action={action} />);
    expect((await screen.findByRole("alert")).textContent).toBe("You've made 25 projects today.");
    expect(screen.getByRole("heading", { name: "Your project wasn't made" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to your projects" }).getAttribute("href")).toBe("/dashboard");
    expect(JSON.parse(window.sessionStorage.getItem(FIRST_PROJECT_KEY)!).asked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  });
});
