// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { act, fireEvent, render, screen, waitFor, within } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, unstable_rethrow: () => {} }));
const signOut = vi.hoisted(() => vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })));
const passkey = vi.hoisted(() => ({
  listUserPasskeys: vi.fn(async () => ({ data: [], error: null })),
  addPasskey: vi.fn(async () => ({ data: {}, error: null })),
  updatePasskey: vi.fn(async () => ({ data: {}, error: null })),
  deletePasskey: vi.fn(async () => ({ data: { status: true }, error: null })),
}));
const signIn = vi.hoisted(() => ({ passkey: vi.fn(async () => ({ data: {}, error: null })), social: vi.fn(async () => ({ data: {}, error: null })) }));
const revokeOtherSessions = vi.hoisted(() => vi.fn(async () => ({ data: { status: true }, error: null })));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut, passkey, signIn, revokeOtherSessions } }));

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  router.refresh.mockClear();
  router.bfcacheId = "b0";
  signOut.mockClear();
  passkey.listUserPasskeys.mockClear();
  window.history.replaceState(null, "", "/dashboard");
});

const account = () => screen.getByRole("button", { name: "Account" });

function pickSignOut() {
  fireEvent.click(account());
  fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
}

describe("the account menu", () => {
  it("the Account button shows the person's picture and name", () => {
    const { rerender } = render(<AccountMenu name="Ada Lovelace" image="https://x.test/a.png" />);
    expect(account().textContent).toContain("Ada Lovelace");
    const img = account().querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://x.test/a.png");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.className).toContain("rounded-full");
    rerender(<AccountMenu name="Ada Lovelace" image={null} />);
    expect(account().querySelector("img")).toBeNull();
    expect(account().textContent).toContain("Ada Lovelace");
  });

  it("Sign out signs out and goes to the login page", async () => {
    render(<AccountMenu name="Ada Lovelace" image={null} />);
    pickSignOut();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login"));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failed sign-out says so", async () => {
    signOut.mockResolvedValueOnce({ error: {} });
    render(<AccountMenu name="Ada Lovelace" image={null} />);
    pickSignOut();
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't sign out. Try again.");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("lists Passkeys, then Sign out", () => {
    render(<AccountMenu name="Ada Lovelace" image={null} />);
    fireEvent.click(account());
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Passkeys", "Sign out"]);
  });

  it("Passkeys opens the Passkeys dialog", async () => {
    render(<AccountMenu name="Ada Lovelace" image={null} />);
    expect(screen.queryByRole("dialog", { name: "Passkeys" })).toBeNull();
    fireEvent.click(account());
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Passkeys" }));
    });
    expect(screen.getByRole("dialog", { name: "Passkeys" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("No passkeys yet.")).toBeTruthy());
    expect(passkey.listUserPasskeys).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Passkeys" })).toBeNull();
  });

  it("coming back from signing in again with ?passkeys=1 opens the dialog and drops the parameter", async () => {
    window.history.replaceState(null, "", "/dashboard?folder=f1&passkeys=1");
    render(<AccountMenu name="Ada Lovelace" image={null} />);
    expect(await screen.findByRole("dialog", { name: "Passkeys" })).toBeTruthy();
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/dashboard?folder=f1", { scroll: false });
    await waitFor(() => expect(passkey.listUserPasskeys).toHaveBeenCalledTimes(1));
  });

  it("back from a Google sign-in that was refused, the dialog says why, and drops the error from the address", async () => {
    window.history.replaceState(null, "", "/dashboard?folder=f1&passkeys=1&error=NOT_ALLOWLISTED&error_description=NOT_ALLOWLISTED");
    render(<AccountMenu name="Ada Lovelace" image={null} />);
    const dialog = await screen.findByRole("dialog", { name: "Passkeys" });
    expect(within(dialog).getByRole("alert").textContent).toBe(
      "That Google account isn't on the Seattle Solvers allowlist. Sign in again with the one you use for EasyEdit.",
    );
    expect(within(dialog).getByRole("button", { name: "Sign in again" })).toBeTruthy();
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/dashboard?folder=f1", { scroll: false });
    await waitFor(() => expect(passkey.listUserPasskeys).toHaveBeenCalledTimes(1));

    // Opened again from the menu, it starts afresh.
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(account());
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Passkeys" }));
    });
    await waitFor(() => expect(screen.getByText("No passkeys yet.")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("without the parameter the dialog stays closed", () => {
    window.history.replaceState(null, "", "/dashboard?folder=f1");
    render(<AccountMenu name="Ada Lovelace" image={null} />);
    expect(screen.queryByRole("dialog", { name: "Passkeys" })).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
    expect(passkey.listUserPasskeys).not.toHaveBeenCalled();
  });
});
