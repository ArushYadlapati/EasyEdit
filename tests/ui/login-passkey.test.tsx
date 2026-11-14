// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import LoginPage from "@/app/(auth)/login/page";
import { PasskeySignInButton } from "@/app/(auth)/login/passkey-sign-in-button";
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
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Sign in with Google",
      "Sign in with a passkey",
    ]);
    expect(document.querySelector("input, textarea, select")).toBeNull();
  });
});

describe("the passkey sign-in button", () => {
  it("reads Sign in with a passkey and is outlined, not filled like the Google button", () => {
    render(<PasskeySignInButton />);
    const classes = button().className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["h-11", "w-full", "rounded-full", "border", "bg-transparent"]));
    expect(classes).not.toContain("bg-foreground");
    expect(button().disabled).toBe(false);
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
      "This account isn't on the Seattle Solvers allowlist. Ask an admin to add you.",
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
