// @vitest-environment happy-dom
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { act, fireEvent, render, screen, waitFor, within } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
// The page the menu is on, as Next reports it.
const at = vi.hoisted(() => ({ path: "/s/personal" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => at.path, unstable_rethrow: () => {} }));
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
  at.path = "/s/personal";
  window.history.replaceState(null, "", "/s/personal");
  // Each test starts with no preferences kept.
  document.cookie = "easyedit-prefs=; path=/s; max-age=0";
  window.localStorage.clear();
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

  it("in a space it lists Settings, Passkeys, AI agents, then Sign out", () => {
    render(<AccountMenu name="Ada Lovelace" image={null} />);
    fireEvent.click(account());
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Settings", "Passkeys", "AI agents", "Sign out"]);
  });

  it("off the space pages there is no Settings: the preferences cookie belongs to /s", () => {
    for (const path of ["/admin", "/agents"]) {
      at.path = path;
      const { unmount } = render(<AccountMenu name="Ada Lovelace" image={null} />);
      fireEvent.click(account());
      expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Passkeys", "AI agents", "Sign out"]);
      unmount();
    }
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
      "That Google account doesn't have access to EasyEdit. If you were invited, sign in with the Google account the invite was sent to.",
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

  describe("Settings", () => {
    const openSettings = async () => {
      fireEvent.click(account());
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
      });
      return screen.getByRole("dialog", { name: "Settings" });
    };
    const kept = () => /(?:^|; )easyedit-prefs=([^;]*)/.exec(document.cookie)?.[1] ?? null;

    it("opens the editor's General and Shortcuts, without the project's section", async () => {
      render(<AccountMenu name="Ada Lovelace" image={null} />);
      expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
      const dialog = await openSettings();
      expect(within(dialog).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["General", "Shortcuts"]);
      expect(within(dialog).getByText(/Saved in this browser only\./)).toBeTruthy();
      expect(within(dialog).getByRole("switch", { name: "Snapping" })).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("tab", { name: "Shortcuts" }));
      expect(within(dialog).getByRole("tab", { name: "Shortcuts" }).getAttribute("aria-selected")).toBe("true");
      expect(within(dialog).queryByRole("switch", { name: "Snapping" })).toBeNull();
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    });

    it("shows what the editor kept, and keeps each change in the same cookie", async () => {
      document.cookie = "easyedit-prefs=u:in.sz:0.sn:0.z:150.st:40.tx:30; path=/s";
      render(<AccountMenu name="Ada Lovelace" image={null} />);
      const dialog = await openSettings();
      expect(within(dialog).getByRole("radio", { name: "Inches" }).getAttribute("aria-checked")).toBe("true");
      const snapping = within(dialog).getByRole("switch", { name: "Snapping" });
      expect(snapping.getAttribute("aria-checked")).toBe("false");

      fireEvent.click(snapping);
      expect(snapping.getAttribute("aria-checked")).toBe("true");
      expect(kept()).toBe("u:in.sz:0.sn:1.z:150.st:40.tx:30.gd:1.am:1.mw:56");
      fireEvent.click(within(dialog).getByRole("switch", { name: "Show safe area" }));
      expect(kept()).toBe("u:in.sz:1.sn:1.z:150.st:40.tx:30.gd:1.am:1.mw:56");
      fireEvent.click(within(dialog).getByRole("radio", { name: "Centimeters" }));
      // The switches chosen here, and the editor's guides switch, stay when another field is saved.
      expect(kept()).toBe("u:cm.sz:1.sn:1.z:150.st:40.tx:30.gd:1.am:1.mw:56");
    });
  });
});

describe("the tutorial in the account menu", () => {
  const VIDEO = { url: "https://cdn.test/easyedit-intro.mp4", poster: "https://cdn.test/easyedit-intro.jpg" };
  type MarkSeen = () => Promise<unknown>;
  let markSeen: ReturnType<typeof vi.fn<MarkSeen>>;
  const menu = (firstVisit: boolean) => <AccountMenu name="Ada Lovelace" image={null} tutorial={{ ...VIDEO, firstVisit, markSeen }} />;
  const welcome = () => screen.queryByRole("dialog", { name: "Welcome to EasyEdit" });
  const items = () => {
    fireEvent.click(account());
    const names = screen.getAllByRole("menuitem").map((item) => item.textContent);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    return names;
  };
  const pickTutorial = () => {
    fireEvent.click(account());
    fireEvent.click(screen.getByRole("menuitem", { name: "Tutorial" }));
  };

  beforeEach(() => {
    markSeen = vi.fn<MarkSeen>(async () => ({}));
    at.path = "/s/rocket";
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("Tutorial sits after AI agents on every dashboard page, when the server has a video", () => {
    const { unmount } = render(menu(false));
    expect(items()).toEqual(["Settings", "Passkeys", "AI agents", "Tutorial", "Sign out"]);
    unmount();
    at.path = "/agents";
    render(menu(false));
    expect(items()).toEqual(["Passkeys", "AI agents", "Tutorial", "Sign out"]);
  });

  it("Tutorial goes to the Learn page, and opens no dialog", () => {
    render(menu(false));
    pickTutorial();
    expect(router.push).toHaveBeenCalledWith("/learn");
    expect(welcome()).toBeNull();
    expect(markSeen).not.toHaveBeenCalled();
  });

  it("on a first visit to a space page the dialog is open at once, and skipping it writes the mark once", () => {
    render(menu(true));
    expect(welcome()).toBeTruthy();
    expect(markSeen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(welcome()).toBeNull();
    expect(markSeen).toHaveBeenCalledTimes(1);
    // From then on Tutorial is the page, as for everyone.
    pickTutorial();
    expect(router.push).toHaveBeenCalledWith("/learn");
    expect(welcome()).toBeNull();
    expect(markSeen).toHaveBeenCalledTimes(1);
  });

  it("on a first visit, playing it writes the mark, and closing afterwards does not write it again", () => {
    render(menu(true));
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    expect(markSeen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(welcome()).toBeNull();
    expect(markSeen).toHaveBeenCalledTimes(1);
  });

  it("it does not open over Admin or AI agents, and opens when the person reaches a space page", () => {
    at.path = "/agents";
    const { rerender } = render(menu(true));
    expect(welcome()).toBeNull();
    at.path = "/admin";
    rerender(menu(true));
    expect(welcome()).toBeNull();
    at.path = "/s/rocket";
    rerender(menu(true));
    expect(welcome()).toBeTruthy();
    expect(markSeen).not.toHaveBeenCalled();
  });

  it("it opens by itself only once in a page load", () => {
    const { rerender } = render(menu(true));
    fireEvent.keyDown(welcome()!, { key: "Escape" });
    expect(welcome()).toBeNull();
    at.path = "/s/rocket/settings/members";
    rerender(menu(true));
    expect(welcome()).toBeNull();
    expect(markSeen).toHaveBeenCalledTimes(1);
  });

  it("the page as the server sends it holds no player: the welcome opens once the page is live, so a failed video is heard", () => {
    const html = renderToString(menu(true));
    expect(html).not.toContain("<video");
    expect(html).toContain("Ada Lovelace");
  });

  it("a welcome whose video cannot load still closes, and still writes the mark once", () => {
    render(menu(true));
    act(() => {
      document.querySelector("video")!.dispatchEvent(new Event("error"));
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(welcome()).toBeNull();
    expect(markSeen).toHaveBeenCalledTimes(1);
  });

  it("when the mark cannot be written the dialog still closes and says nothing", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    markSeen.mockRejectedValue(new Error("offline"));
    render(menu(true));
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    process.off("unhandledRejection", unhandled);
    expect(welcome()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(unhandled).not.toHaveBeenCalled();
  });
});
