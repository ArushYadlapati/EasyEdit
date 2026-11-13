// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { fireEvent, render, screen, waitFor } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, unstable_rethrow: () => {} }));
const signOut = vi.hoisted(() => vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut } }));

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  router.refresh.mockClear();
  router.bfcacheId = "b0";
  signOut.mockClear();
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
});
