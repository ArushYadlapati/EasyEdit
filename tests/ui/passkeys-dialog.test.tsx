// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PasskeysDialog } from "@/components/dashboard/passkeys-dialog";
import { act, fireEvent, render, screen, waitFor, within } from "../helpers/dom";

type ClientError = { code?: string; message?: string; status?: number };
type Result = { data: unknown; error: ClientError | null };
type Row = { id: string; name?: string; createdAt: Date };

const client = vi.hoisted(() => ({
  listUserPasskeys: vi.fn(async (): Promise<Result> => ({ data: [], error: null })),
  addPasskey: vi.fn(async (): Promise<Result> => ({ data: {}, error: null })),
  updatePasskey: vi.fn<(input: { id: string; name: string }) => Promise<Result>>(async () => ({ data: {}, error: null })),
  deletePasskey: vi.fn<(input: { id: string }) => Promise<Result>>(async () => ({ data: { status: true }, error: null })),
  signInPasskey: vi.fn(async (): Promise<Result> => ({ data: {}, error: null })),
  signInSocial: vi.fn<(input: unknown) => Promise<Result>>(async () => ({ data: { redirect: true }, error: null })),
  revokeOtherSessions: vi.fn(async (): Promise<Result> => ({ data: { status: true }, error: null })),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    passkey: {
      listUserPasskeys: client.listUserPasskeys,
      addPasskey: client.addPasskey,
      updatePasskey: client.updatePasskey,
      deletePasskey: client.deletePasskey,
    },
    signIn: { passkey: client.signInPasskey, social: client.signInSocial },
    revokeOtherSessions: client.revokeOtherSessions,
  },
}));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const THIS_YEAR = new Date().getFullYear();
const ONE_PASSWORD: Row = { id: "pk1", name: "1Password", createdAt: new Date(Date.UTC(THIS_YEAR, 10, 13, 12)) };
const KEYCHAIN: Row = { id: "pk2", name: "Passkey", createdAt: new Date(Date.UTC(THIS_YEAR, 10, 10, 12)) };
const OLD_KEY: Row = { id: "pk3", name: "YubiKey", createdAt: new Date(Date.UTC(THIS_YEAR - 1, 4, 2, 12)) };

// What the passkey client answers when the browser's sheet is closed, or times out: a NotAllowedError passed through,
// or an aborted ceremony.
const CANCELS: ClientError[] = [
  {
    code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
    message: "The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sec-assertion-privacy.",
    status: 400,
  },
  { code: "ERROR_CEREMONY_ABORTED", message: "Registration cancelled", status: 400 },
];
const TOO_OLD: ClientError = { code: "SESSION_NOT_FRESH", message: "Session is not fresh", status: 403 };

const onClose = vi.fn<() => void>();

beforeEach(() => {
  // mockReset also drops answers queued with ...Once that a failed test left unused, and goes back to the defaults above.
  for (const fn of Object.values(client)) fn.mockReset();
  client.listUserPasskeys.mockImplementation(async () => ({ data: [ONE_PASSWORD, KEYCHAIN], error: null }));
  router.refresh.mockClear();
  onClose.mockClear();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const dialog = (name = "Passkeys") => screen.getByRole("dialog", { name });
const button = (name: string, inside: HTMLElement = dialog()) => within(inside).getByRole("button", { name }) as HTMLButtonElement;
const listed = () => within(dialog()).queryAllByRole("listitem").map((item) => item.textContent);

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function openDialog() {
  render(<PasskeysDialog open onClose={onClose} />);
  await waitFor(() => expect(within(dialog()).queryByText("Loading…")).toBeNull());
}

describe("the Passkeys dialog", () => {
  it("loads the passkeys when it opens and lists each with the day it was added", async () => {
    client.listUserPasskeys.mockResolvedValueOnce({ data: [ONE_PASSWORD, KEYCHAIN, OLD_KEY, { ...KEYCHAIN, id: "pk4", name: undefined, createdAt: new Date(Date.UTC(THIS_YEAR, 9, 1, 12)) }], error: null });
    const { rerender } = render(<PasskeysDialog open={false} onClose={onClose} />);
    expect(client.listUserPasskeys).not.toHaveBeenCalled();
    rerender(<PasskeysDialog open onClose={onClose} />);
    expect(within(dialog()).getByText("Sign in with a passkey instead of Google.")).toBeTruthy();
    await waitFor(() => expect(listed()).toHaveLength(4));
    expect(client.listUserPasskeys).toHaveBeenCalledTimes(1);
    expect(listed()).toEqual([
      expect.stringContaining("1Password"),
      expect.stringContaining("Passkey"),
      expect.stringContaining("Passkey"),
      expect.stringContaining("YubiKey"),
    ]);
    const rows = within(dialog()).getAllByRole("listitem");
    expect(within(rows[0]).getByText("Added Nov 13")).toBeTruthy();
    expect(within(rows[1]).getByText("Added Nov 10")).toBeTruthy();
    expect(within(rows[2]).getByText("Added Oct 1")).toBeTruthy();
    expect(within(rows[3]).getByText(`Added May 2, ${THIS_YEAR - 1}`)).toBeTruthy();
    expect(button("Rename 1Password").textContent).toBe("Rename");
    expect(button("Remove 1Password").textContent).toBe("Remove");
    expect(button("Add a passkey")).toBeTruthy();
    expect(button("Sign out all other devices")).toBeTruthy();
  });

  it("lists the newest first, whatever order the server sends them in", async () => {
    // The server keeps no order: a sign-in or a rename rewrites a passkey's row, which can move it in the table.
    client.listUserPasskeys.mockResolvedValueOnce({ data: [OLD_KEY, KEYCHAIN, ONE_PASSWORD], error: null });
    await openDialog();
    expect(listed()).toEqual([expect.stringContaining("1Password"), expect.stringContaining("Passkey"), expect.stringContaining("YubiKey")]);
    // Passkeys added in the same moment keep one order too.
    const twins = [{ ...KEYCHAIN, id: "pk9", name: "B" }, { ...KEYCHAIN, id: "pk8", name: "A" }];
    client.listUserPasskeys.mockResolvedValueOnce({ data: [twins[0], twins[1]], error: null });
    await click(button("Add a passkey"));
    await waitFor(() => expect(listed()).toEqual([expect.stringContaining("A"), expect.stringContaining("B")]));
  });

  it("with no passkeys it says so and still offers Add", async () => {
    client.listUserPasskeys.mockResolvedValueOnce({ data: [], error: null });
    await openDialog();
    expect(within(dialog()).getByText("No passkeys yet.")).toBeTruthy();
    expect(listed()).toEqual([]);
    expect(button("Add a passkey").disabled).toBe(false);
  });

  it("says so when the list can't be loaded", async () => {
    client.listUserPasskeys.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    await openDialog();
    expect(within(dialog()).getByRole("alert").textContent).toBe("Couldn't load your passkeys. Close this and try again.");
  });

  it("each opening loads the list afresh", async () => {
    const { rerender } = render(<PasskeysDialog open onClose={onClose} />);
    await waitFor(() => expect(listed()).toHaveLength(2));
    rerender(<PasskeysDialog open={false} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    client.listUserPasskeys.mockResolvedValueOnce({ data: [KEYCHAIN], error: null });
    rerender(<PasskeysDialog open onClose={onClose} />);
    await waitFor(() => expect(listed()).toHaveLength(1));
    expect(client.listUserPasskeys).toHaveBeenCalledTimes(2);
  });
});

describe("adding a passkey", () => {
  it("Add a passkey opens the browser's sheet, then the new one shows in the list", async () => {
    await openDialog();
    const added: Row = { id: "pk5", name: "Google Password Manager", createdAt: new Date(Date.UTC(THIS_YEAR, 10, 20, 12)) };
    client.listUserPasskeys.mockResolvedValueOnce({ data: [ONE_PASSWORD, KEYCHAIN, added], error: null });
    await click(button("Add a passkey"));
    expect(client.addPasskey).toHaveBeenCalledTimes(1);
    expect(client.addPasskey).toHaveBeenCalledWith();
    await waitFor(() => expect(listed()).toHaveLength(3));
    expect(listed()[0]).toContain("Google Password Manager");
    expect(within(dialog()).queryByRole("alert")).toBeNull();
  });

  it("added, but the list didn't load again: the old list stays, with a message", async () => {
    await openDialog();
    client.listUserPasskeys.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    await click(button("Add a passkey"));
    await waitFor(() => expect(within(dialog()).queryByRole("alert")).not.toBeNull());
    expect(within(dialog()).getByRole("alert").textContent).toBe("Couldn't load your passkeys. Close this and try again.");
    expect(listed()).toHaveLength(2);
  });

  it("pressing Add twice sends once, and the other buttons wait while it runs", async () => {
    await openDialog();
    const adding = deferred<Result>();
    client.addPasskey.mockReturnValueOnce(adding.promise);
    fireEvent.click(button("Add a passkey"));
    fireEvent.click(button("Add a passkey"));
    expect(client.addPasskey).toHaveBeenCalledTimes(1);
    for (const name of ["Add a passkey", "Rename 1Password", "Remove 1Password", "Sign out all other devices"]) {
      expect(button(name).disabled).toBe(true);
    }
    await act(async () => adding.resolve({ data: {}, error: null }));
    await waitFor(() => expect(button("Add a passkey").disabled).toBe(false));
    expect(button("Remove 1Password").disabled).toBe(false);
    expect(client.addPasskey).toHaveBeenCalledTimes(1);
  });

  it.each(CANCELS)("closing the browser's sheet says nothing ($code)", async (error) => {
    await openDialog();
    client.addPasskey.mockResolvedValueOnce({ data: null, error });
    await click(button("Add a passkey"));
    expect(within(dialog()).queryByRole("alert")).toBeNull();
    expect(within(dialog()).queryByRole("status")).toBeNull();
    expect(button("Add a passkey").disabled).toBe(false);
    expect(client.listUserPasskeys).toHaveBeenCalledTimes(1);
  });

  it("a passkey manager that already holds one for this account says so", async () => {
    await openDialog();
    client.addPasskey.mockResolvedValueOnce({
      data: null,
      error: { code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED", message: "Previously registered", status: 400 },
    });
    await click(button("Add a passkey"));
    expect(within(dialog()).getByRole("alert").textContent).toBe("This passkey manager already has a passkey for your account.");
    expect(button("Add a passkey").disabled).toBe(false);
  });

  it("any other failure says the passkey wasn't added", async () => {
    await openDialog();
    client.addPasskey.mockResolvedValueOnce({ data: null, error: { code: "FAILED_TO_VERIFY_REGISTRATION", status: 400 } });
    await click(button("Add a passkey"));
    expect(within(dialog()).getByRole("alert").textContent).toBe("The passkey wasn't added. Try again.");
    client.addPasskey.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await click(button("Add a passkey"));
    expect(within(dialog()).getByRole("alert").textContent).toBe("The passkey wasn't added. Try again.");
    expect(button("Add a passkey").disabled).toBe(false);
  });

  it("a sign-in older than a day asks to sign in again with Google, coming back to this dialog", async () => {
    await openDialog();
    client.addPasskey.mockResolvedValueOnce({ data: null, error: TOO_OLD });
    await click(button("Add a passkey"));
    const alert = within(dialog()).getByRole("alert");
    expect(alert.textContent).toContain("For your safety, sign in again before adding a passkey.");
    await click(button("Sign in again"));
    expect(client.signInSocial).toHaveBeenCalledTimes(1);
    // A refused sign-in comes back to the dialog too: the old session is still there, so /login would only send the
    // member on to the dashboard and drop the reason.
    expect(client.signInSocial).toHaveBeenCalledWith({ provider: "google", callbackURL: "/dashboard?passkeys=1", errorCallbackURL: "/dashboard?passkeys=1" });
    // The page is leaving for Google, so nothing else can be pressed meanwhile.
    expect(button("Sign in again").disabled).toBe(true);
    expect(button("Add a passkey").disabled).toBe(true);
  });

  it.each([
    ["NOT_ALLOWLISTED", "That Google account isn't on the Seattle Solvers allowlist. Sign in again with the one you use for EasyEdit."],
    ["access_denied", "Google sign-in didn't finish. Try again."],
  ])("back from a Google sign-in that failed (%s), it says why and offers Sign in again", async (code, message) => {
    render(<PasskeysDialog open signInError={code} onClose={onClose} />);
    await waitFor(() => expect(listed()).toHaveLength(2));
    expect(within(dialog()).getByRole("alert").textContent).toBe(message);
    expect(button("Sign in again").disabled).toBe(false);
    expect(button("Use a passkey").disabled).toBe(false);
  });

  it("with no passkey yet, Google is the only way to sign in again", async () => {
    client.listUserPasskeys.mockResolvedValueOnce({ data: [], error: null });
    await openDialog();
    client.addPasskey.mockResolvedValueOnce({ data: null, error: TOO_OLD });
    await click(button("Add a passkey"));
    expect(button("Sign in again")).toBeTruthy();
    expect(within(dialog()).queryByRole("button", { name: "Use a passkey" })).toBeNull();
  });

  it("a member with a passkey can sign in again with it and carry on in the dialog", async () => {
    await openDialog();
    client.addPasskey.mockResolvedValueOnce({ data: null, error: TOO_OLD });
    await click(button("Add a passkey"));
    client.signInPasskey.mockResolvedValueOnce({ data: null, error: CANCELS[0] });
    await click(button("Use a passkey"));
    expect(client.signInPasskey).toHaveBeenCalledTimes(1);
    expect(within(dialog()).getByRole("alert").textContent).toContain("For your safety, sign in again before adding a passkey.");
    expect(button("Use a passkey").disabled).toBe(false);

    await click(button("Use a passkey"));
    expect(client.signInPasskey).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(within(dialog()).queryByRole("alert")).toBeNull());
    expect(client.listUserPasskeys).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(button("Add a passkey").disabled).toBe(false);
  });

  it.each([
    { code: "PASSKEY_NOT_FOUND", status: 400 },
    // What the passkey client answers when the request to check the passkey got no answer, after the member approved it.
    { code: "AUTH_CANCELLED", message: "Auth cancelled", status: 400 },
  ])("a passkey sign-in that fails says so and keeps Sign in again ($code)", async (error) => {
    await openDialog();
    client.addPasskey.mockResolvedValueOnce({ data: null, error: TOO_OLD });
    await click(button("Add a passkey"));
    client.signInPasskey.mockResolvedValueOnce({ data: null, error });
    await click(button("Use a passkey"));
    expect(within(dialog()).getByRole("alert").textContent).toContain("Passkey sign-in didn't finish. Try again, or sign in with Google.");
    expect(button("Sign in again").disabled).toBe(false);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("renaming a passkey", () => {
  const field = () => within(dialog()).getByRole("textbox", { name: "New name for 1Password" }) as HTMLInputElement;

  async function rename(value: string, key = "Enter") {
    await openDialog();
    await click(button("Rename 1Password"));
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe("1Password");
    expect(field().maxLength).toBe(60);
    fireEvent.change(field(), { target: { value } });
    await act(async () => {
      fireEvent.keyDown(field(), { key });
    });
  }

  it("Enter saves the trimmed name", async () => {
    await rename("  Team vault  ");
    expect(client.updatePasskey).toHaveBeenCalledTimes(1);
    expect(client.updatePasskey).toHaveBeenCalledWith({ id: "pk1", name: "Team vault" });
    await waitFor(() => expect(listed()[0]).toContain("Team vault"));
    expect(within(dialog()).queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(button("Rename Team vault"));
  });

  it("Escape keeps the old name", async () => {
    await rename("Team vault", "Escape");
    expect(client.updatePasskey).not.toHaveBeenCalled();
    expect(within(dialog()).queryByRole("textbox")).toBeNull();
    expect(listed()[0]).toContain("1Password");
    // Escape belonged to the field, so the dialog stays open.
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty name", "   "],
    ["a name over 60 characters", "x".repeat(61)],
    ["the same name", "1Password"],
  ])("%s isn't sent", async (_, value) => {
    await rename(value);
    expect(client.updatePasskey).not.toHaveBeenCalled();
    expect(listed()[0]).toContain("1Password");
  });

  it("a refused rename keeps the old name and says so", async () => {
    client.updatePasskey.mockResolvedValueOnce({ data: null, error: { code: "FAILED_TO_UPDATE_PASSKEY", status: 500 } });
    await rename("Team vault");
    expect(within(dialog()).getByRole("alert").textContent).toBe("The passkey wasn't renamed. Try again.");
    expect(listed()[0]).toContain("1Password");
  });

  it("while a rename is saving, the other buttons wait", async () => {
    const saving = deferred<Result>();
    client.updatePasskey.mockReturnValueOnce(saving.promise);
    await rename("Team vault");
    for (const name of ["Add a passkey", "Rename Passkey", "Remove Passkey", "Sign out all other devices"]) {
      expect(button(name).disabled).toBe(true);
    }
    await act(async () => saving.resolve({ data: {}, error: null }));
    await waitFor(() => expect(button("Add a passkey").disabled).toBe(false));
  });
});

describe("removing a passkey", () => {
  const confirm = () => dialog("Remove passkey");
  const checkbox = () => within(confirm()).getByRole("checkbox", { name: "Also sign out all other devices" }) as HTMLInputElement;

  async function askToRemove() {
    await openDialog();
    await click(button("Remove 1Password"));
  }

  it("asks first, reminds them about their passkey manager, and removes it", async () => {
    await askToRemove();
    expect(within(confirm()).getByText("Remove “1Password”? You can still sign in with Google.")).toBeTruthy();
    expect(within(confirm()).getByText("Delete it from your passkey manager too. EasyEdit can't do that for you.")).toBeTruthy();
    expect(checkbox().checked).toBe(false);
    expect(document.activeElement).toBe(button("Cancel", confirm()));
    await click(button("Remove", confirm()));
    expect(client.deletePasskey).toHaveBeenCalledTimes(1);
    expect(client.deletePasskey).toHaveBeenCalledWith({ id: "pk1" });
    expect(client.revokeOtherSessions).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove passkey" })).toBeNull());
    expect(listed()).toEqual([expect.stringContaining("Passkey")]);
    // The button that opened the confirm dialog left with its row, so focus goes to the row now in its place.
    expect(document.activeElement).toBe(button("Remove Passkey"));
  });

  it("removing the last row puts focus on the row above, and removing the only one on Add a passkey", async () => {
    await openDialog();
    await click(button("Remove Passkey"));
    await click(button("Remove", confirm()));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove passkey" })).toBeNull());
    expect(document.activeElement).toBe(button("Remove 1Password"));

    await click(button("Remove 1Password"));
    await click(checkbox());
    await click(button("Remove", confirm()));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove passkey" })).toBeNull());
    expect(within(dialog()).getByText("No passkeys yet.")).toBeTruthy();
    expect(document.activeElement).toBe(button("Add a passkey"));
  });

  it("Cancel keeps it", async () => {
    await askToRemove();
    await click(button("Cancel", confirm()));
    expect(screen.queryByRole("dialog", { name: "Remove passkey" })).toBeNull();
    expect(client.deletePasskey).not.toHaveBeenCalled();
    expect(listed()).toHaveLength(2);
  });

  it("with the box ticked, it also signs out every other device", async () => {
    await askToRemove();
    await click(checkbox());
    expect(checkbox().checked).toBe(true);
    await click(button("Remove", confirm()));
    await waitFor(() => expect(client.revokeOtherSessions).toHaveBeenCalledTimes(1));
    expect(client.deletePasskey.mock.invocationCallOrder[0]).toBeLessThan(client.revokeOtherSessions.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove passkey" })).toBeNull());
    expect(within(dialog()).getByRole("status").textContent).toBe("Signed out of all other devices.");
    expect(listed()).toHaveLength(1);
  });

  it("the box starts unticked each time", async () => {
    await askToRemove();
    await click(checkbox());
    await click(button("Cancel", confirm()));
    await click(button("Remove Passkey"));
    expect(checkbox().checked).toBe(false);
  });

  it("a refused removal stays in the confirm dialog and keeps the passkey", async () => {
    client.deletePasskey.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    await askToRemove();
    await click(checkbox());
    await click(button("Remove", confirm()));
    expect(within(confirm()).getByRole("alert").textContent).toBe("The passkey wasn't removed. Try again.");
    expect(client.revokeOtherSessions).not.toHaveBeenCalled();
    expect(listed()).toHaveLength(2);
  });

  it("removed, but the other devices couldn't be signed out: it says what happened", async () => {
    client.revokeOtherSessions.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    await askToRemove();
    await click(checkbox());
    await click(button("Remove", confirm()));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove passkey" })).toBeNull());
    expect(within(dialog()).getByRole("alert").textContent).toBe(
      "The passkey was removed, but other devices weren't signed out. Try Sign out all other devices.",
    );
    expect(listed()).toHaveLength(1);
  });

  it("Remove pressed twice sends once", async () => {
    const removing = deferred<Result>();
    client.deletePasskey.mockReturnValueOnce(removing.promise);
    await askToRemove();
    fireEvent.click(button("Remove", confirm()));
    fireEvent.click(button("Remove", confirm()));
    expect(client.deletePasskey).toHaveBeenCalledTimes(1);
    expect(button("Remove", confirm()).disabled).toBe(true);
    expect(checkbox().disabled).toBe(true);
    await act(async () => removing.resolve({ data: { status: true }, error: null }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove passkey" })).toBeNull());
  });
});

describe("signing out all other devices", () => {
  const confirm = () => dialog("Sign out all other devices");

  it("asks first, then signs out every other device", async () => {
    await openDialog();
    await click(button("Sign out all other devices"));
    expect(within(confirm()).getByText("Sign out every other device signed in to this account? This device stays signed in.")).toBeTruthy();
    expect(client.revokeOtherSessions).not.toHaveBeenCalled();
    await click(button("Sign out other devices", confirm()));
    expect(client.revokeOtherSessions).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign out all other devices" })).toBeNull());
    expect(within(dialog()).getByRole("status").textContent).toBe("Signed out of all other devices.");
    expect(client.deletePasskey).not.toHaveBeenCalled();
  });

  it("Cancel signs nothing out", async () => {
    await openDialog();
    await click(button("Sign out all other devices"));
    await click(button("Cancel", confirm()));
    expect(screen.queryByRole("dialog", { name: "Sign out all other devices" })).toBeNull();
    expect(client.revokeOtherSessions).not.toHaveBeenCalled();
  });

  it("a refusal stays in the confirm dialog", async () => {
    client.revokeOtherSessions.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    await openDialog();
    await click(button("Sign out all other devices"));
    await click(button("Sign out other devices", confirm()));
    expect(within(confirm()).getByRole("alert").textContent).toBe("The other devices weren't signed out. Try again.");
    expect(within(dialog()).queryByRole("status")).toBeNull();
  });
});
