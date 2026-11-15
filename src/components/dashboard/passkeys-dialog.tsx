"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { InlineEdit } from "@/components/ui/inline-edit";
import { authClient } from "@/lib/auth-client";
import { UNVERIFIED_EMAIL } from "@/lib/login-error-message";

export type PasskeysDialogProps = {
  open: boolean;
  onClose(): void;
  // The error code a Google sign-in from Sign in again came back with, when it failed.
  signInError?: string | null;
  // Whether anyone may make an account: then a refused Google sign-in means Google hasn't verified the email.
  openSignUp?: boolean;
};

type Passkey = { id: string; name: string; createdAt: Date };
type Action = "add" | "sign-in" | "rename" | "remove" | "sign-out";
type Failure = { code?: string; message?: string; status?: number };
type Outcome<T> = { data: T | null; error: Failure | null };
type Notice = { alert: boolean; text: string };

const NAME_CHARS = 60;
const UNNAMED = "Passkey";

// What the passkey client answers when the browser's passkey sheet is closed or times out (a NotAllowedError passed
// through, or an aborted ceremony). The person chose that, so it needs no message. Not AUTH_CANCELLED: despite its
// name, a passkey sign-in answers it when the request that checks an approved passkey throws, which is a failure.
const CANCELLED = new Set([
  "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
  "ERROR_CEREMONY_ABORTED",
  "REGISTRATION_CANCELLED",
  "NotAllowedError",
  "AbortError",
]);
// The browser refused because the passkey manager already holds a passkey for this account (an InvalidStateError).
const ALREADY_THERE = new Set(["ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED", "PREVIOUSLY_REGISTERED", "InvalidStateError"]);

const MESSAGES = {
  load: "Couldn't load your passkeys. Close this and try again.",
  add: "The passkey wasn't added. Try again.",
  alreadyThere: "This passkey manager already has a passkey for your account.",
  tooOld: "For your safety, sign in again before adding a passkey.",
  passkeySignIn: "Passkey sign-in didn't finish. Try again, or sign in with Google.",
  googleSignIn: "Google sign-in didn't start. Try again.",
  googleNotAllowed: "That Google account isn't on the Seattle Solvers allowlist. Sign in again with the one you use for EasyEdit.",
  googleDidNotFinish: "Google sign-in didn't finish. Try again.",
  rename: "The passkey wasn't renamed. Try again.",
  remove: "The passkey wasn't removed. Try again.",
  removedNotSignedOut: "The passkey was removed, but other devices weren't signed out. Try Sign out all other devices.",
  signOut: "The other devices weren't signed out. Try again.",
  signedOut: "Signed out of all other devices.",
};

const cancelled = (error: Failure) => CANCELLED.has(error.code ?? "");

// Why a Google sign-in from Sign in again came back without signing in, or null when it didn't fail.
function googleSignInMessage(code: string | null | undefined, openSignUp: boolean): string | null {
  if (!code) return null;
  if (code.toUpperCase() !== "NOT_ALLOWLISTED") return MESSAGES.googleDidNotFinish;
  return openSignUp ? UNVERIFIED_EMAIL : MESSAGES.googleNotAllowed;
}

// The auth client answers a refusal with an error; a request that got no answer at all throws, and reads the same here.
async function settle<T>(send: () => Promise<{ data: T | null; error: unknown }>): Promise<Outcome<T>> {
  try {
    const { data, error } = await send();
    return error ? { data: null, error: error as Failure } : { data, error: null };
  } catch {
    return { data: null, error: {} };
  }
}

// The member's passkeys, newest first, or null when they could not be loaded. The server keeps no order (a sign-in or
// a rename rewrites a passkey's row, which can move it), so the list is sorted here, by id among passkeys added together.
async function fetchPasskeys(): Promise<Passkey[] | null> {
  const { data, error } = await settle(() => authClient.passkey.listUserPasskeys());
  if (error || !data) return null;
  return data
    .map((passkey) => ({ id: passkey.id, name: passkey.name || UNNAMED, createdAt: new Date(passkey.createdAt) }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// "Nov 13" this year, "May 2, 2025" before.
function addedOn(date: Date): string {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" }).format(date);
}

// The member's passkeys, from the account menu: add one, rename or remove one, and sign out every other device.
// Each opening starts afresh and loads the list again: the dialog below is mounted anew each time it opens.
export function PasskeysDialog(props: PasskeysDialogProps): ReactNode {
  const [openings, setOpenings] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpenings(openings + 1);
  }
  return <Passkeys key={openings} {...props} />;
}

// One action runs at a time, and every action button is off while it does, so nothing is sent twice or crosses.
// Adding a passkey needs a sign-in from the last day; when the server says it is older, the dialog offers to sign in
// again: with Google, which comes back to /dashboard?passkeys=1 whether it worked or not (the account menu reopens this
// dialog from that, with the error if there was one), or with one of the member's passkeys, which stays here.
function Passkeys({ open, onClose, signInError, openSignUp = false }: PasskeysDialogProps): ReactNode {
  const router = useRouter();
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null); // null until loaded
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const busy = useRef(false); // set at once, before the buttons turn off, so a second press in the same moment stops here
  const [notice, setNotice] = useState<Notice | null>(null);
  // Why to sign in again, shown with the ways to do it.
  const [reauth, setReauth] = useState<string | null>(() => googleSignInMessage(signInError, openSignUp));
  const [renaming, setRenaming] = useState<string | null>(null);
  const refocus = useRef<string | null>(null); // the passkey whose Rename button takes focus back once its rename ends
  const list = useRef<HTMLUListElement>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const removedAt = useRef<number | null>(null); // where the removed passkey's row was, so focus can go to the one now there
  const addButton = useRef<HTMLButtonElement>(null);
  const [alsoSignOut, setAlsoSignOut] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // A list that can't be loaded leaves the last one shown, with a message.
  async function load() {
    const loaded = await fetchPasskeys();
    setLoadFailed(loaded === null);
    if (loaded !== null) setPasskeys(loaded);
  }

  useEffect(() => {
    if (!open) return;
    let current = true;
    void fetchPasskeys().then((loaded) => {
      if (!current) return;
      setLoadFailed(loaded === null);
      if (loaded !== null) setPasskeys(loaded);
    });
    return () => {
      current = false;
    };
  }, [open]);

  // A rename ended by Enter or Escape gives focus back to its Rename button, once that is on again.
  useEffect(() => {
    const id = refocus.current;
    if (id === null || renaming !== null || pending !== null) return;
    refocus.current = null;
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>("[data-rename]") ?? [];
    [...buttons].find((button) => button.dataset.rename === id)?.focus();
  }, [renaming, pending]);

  // A removed passkey's row leaves with the Remove button that opened the confirm dialog, so closing it has nowhere to
  // put focus back, and focus would drop to the page. It goes to the row now in that place (the last row, if the
  // removed one was last), or to Add a passkey when none are left.
  useEffect(() => {
    const at = removedAt.current;
    if (at === null || removing !== null || pending !== null) return;
    removedAt.current = null;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("[data-remove]") ?? [])];
    (buttons[Math.min(at, buttons.length - 1)] ?? addButton.current)?.focus();
  }, [removing, pending]);

  async function run(action: Action, work: () => Promise<"leaving" | void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(action);
    let leaving = false;
    try {
      leaving = (await work()) === "leaving";
    } finally {
      // While the page leaves for another sign-in, everything stays off.
      if (!leaving) {
        busy.current = false;
        setPending(null);
      }
    }
  }

  function add() {
    void run("add", async () => {
      setNotice(null);
      setReauth(null);
      const { error } = await settle(() => authClient.passkey.addPasskey());
      if (!error) return load();
      if (cancelled(error)) return;
      if (error.code === "SESSION_NOT_FRESH") setReauth(MESSAGES.tooOld);
      else setNotice({ alert: true, text: ALREADY_THERE.has(error.code ?? "") ? MESSAGES.alreadyThere : MESSAGES.add });
    });
  }

  function signInWithGoogle() {
    void run("sign-in", async () => {
      const { error } = await settle(() =>
        // A refused sign-in comes back here too: /login would see the session this page still has and send the member
        // on to the dashboard, with the dialog closed and the reason dropped.
        authClient.signIn.social({ provider: "google", callbackURL: "/dashboard?passkeys=1", errorCallbackURL: "/dashboard?passkeys=1" }),
      );
      if (!error) return "leaving";
      setReauth(MESSAGES.googleSignIn);
    });
  }

  function signInWithPasskey() {
    void run("sign-in", async () => {
      const { error } = await settle(() => authClient.signIn.passkey());
      if (error) {
        if (!cancelled(error)) setReauth(MESSAGES.passkeySignIn);
        return;
      }
      setReauth(null);
      // The passkey picked may open another account than the one the page shows, so the page catches up.
      router.refresh();
      await load();
    });
  }

  function startRename(passkey: Passkey) {
    setNotice(null);
    setRenaming(passkey.id);
  }

  function endRename(passkey: Passkey, value: string | null, byKey: boolean) {
    if (byKey) refocus.current = passkey.id;
    setRenaming(null);
    const name = value?.trim() ?? "";
    if (name === "" || name.length > NAME_CHARS || name === passkey.name) return;
    void run("rename", async () => {
      const { error } = await settle(() => authClient.passkey.updatePasskey({ id: passkey.id, name }));
      if (error) {
        setNotice({ alert: true, text: MESSAGES.rename });
        return;
      }
      setPasskeys((all) => all && all.map((each) => (each.id === passkey.id ? { ...each, name } : each)));
    });
  }

  function askToRemove(passkey: Passkey) {
    setNotice(null);
    setRemoveError(null);
    setAlsoSignOut(false);
    setRemoving(passkey);
  }

  function remove() {
    const passkey = removing;
    if (passkey === null) return;
    void run("remove", async () => {
      setRemoveError(null);
      const { error } = await settle(() => authClient.passkey.deletePasskey({ id: passkey.id }));
      // Already gone, as when it was removed from another device, is what was asked for.
      if (error && error.code !== "PASSKEY_NOT_FOUND") {
        setRemoveError(MESSAGES.remove);
        return;
      }
      removedAt.current = Math.max(0, passkeys?.findIndex((each) => each.id === passkey.id) ?? 0);
      setPasskeys((all) => all && all.filter((each) => each.id !== passkey.id));
      if (alsoSignOut) {
        const signedOut = await settle(() => authClient.revokeOtherSessions());
        setNotice(signedOut.error ? { alert: true, text: MESSAGES.removedNotSignedOut } : { alert: false, text: MESSAGES.signedOut });
      }
      setRemoving(null);
    });
  }

  function askToSignOut() {
    setNotice(null);
    setSignOutError(null);
    setSigningOut(true);
  }

  function signOutOthers() {
    void run("sign-out", async () => {
      setSignOutError(null);
      const { error } = await settle(() => authClient.revokeOtherSessions());
      if (error) {
        setSignOutError(MESSAGES.signOut);
        return;
      }
      setSigningOut(false);
      setNotice({ alert: false, text: MESSAGES.signedOut });
    });
  }

  const waiting = pending !== null;
  const hasPasskey = (passkeys?.length ?? 0) > 0;

  return (
    <>
      <Dialog
        title="Passkeys"
        open={open}
        onClose={onClose}
        footer={
          <Button className="mr-auto" disabled={waiting} onClick={askToSignOut}>
            Sign out all other devices
          </Button>
        }
      >
        <p className="text-ed-muted">Sign in with a passkey instead of Google.</p>
        <div className="mt-3 border-y border-ed-line">
          {passkeys === null ? (
            !loadFailed && <p className="py-3 text-ed-muted">Loading…</p>
          ) : passkeys.length === 0 ? (
            <p className="py-3 text-ed-muted">No passkeys yet.</p>
          ) : (
            <ul ref={list} className="divide-y divide-ed-line">
              {passkeys.map((passkey) => (
                <li key={passkey.id} className="flex min-h-12 items-center gap-2 py-2">
                  {renaming === passkey.id ? (
                    <InlineEdit
                      label={`New name for ${passkey.name}`}
                      defaultValue={passkey.name}
                      maxLength={NAME_CHARS}
                      className="flex-1"
                      onDone={(value, byKey) => endRename(passkey, value, byKey)}
                    />
                  ) : (
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{passkey.name}</span>
                      <span className="text-xs text-ed-muted">Added {addedOn(passkey.createdAt)}</span>
                    </span>
                  )}
                  <Button
                    size="sm"
                    aria-label={`Rename ${passkey.name}`}
                    data-rename={passkey.id}
                    disabled={waiting || renaming === passkey.id}
                    onClick={() => startRename(passkey)}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    aria-label={`Remove ${passkey.name}`}
                    data-remove={passkey.id}
                    disabled={waiting}
                    onClick={() => askToRemove(passkey)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {loadFailed && (
            <p role="alert" className="border-t border-ed-line py-3 text-xs text-ed-danger first:border-t-0">
              {MESSAGES.load}
            </p>
          )}
        </div>
        {reauth !== null && (
          <div className="mt-3 flex flex-col gap-2 rounded-md border border-ed-line bg-ed-raised p-3">
            <p role="alert">{reauth}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={waiting} onClick={signInWithGoogle}>
                Sign in again
              </Button>
              {hasPasskey && (
                <Button disabled={waiting} onClick={signInWithPasskey}>
                  Use a passkey
                </Button>
              )}
            </div>
          </div>
        )}
        {notice && (
          <p role={notice.alert ? "alert" : "status"} className={cx("mt-3 text-xs", notice.alert ? "text-ed-danger" : "text-ed-muted")}>
            {notice.text}
          </p>
        )}
        <Button ref={addButton} variant="primary" className="mt-3" disabled={waiting} onClick={add}>
          Add a passkey
        </Button>
      </Dialog>
      <ConfirmDialog
        title="Remove passkey"
        question={`Remove “${removing?.name ?? ""}”? You can still sign in with Google.`}
        confirmLabel="Remove"
        open={open && removing !== null}
        pending={pending === "remove"}
        error={removeError}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      >
        <p className="mt-2 text-ed-muted">Delete it from your passkey manager too. EasyEdit can&apos;t do that for you.</p>
        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            className="size-3.5 accent-ed-accent disabled:opacity-40"
            checked={alsoSignOut}
            disabled={pending === "remove"}
            onChange={(event) => setAlsoSignOut(event.target.checked)}
          />
          Also sign out all other devices
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        title="Sign out all other devices"
        question="Sign out every other device signed in to this account? This device stays signed in."
        confirmLabel="Sign out other devices"
        open={open && signingOut}
        pending={pending === "sign-out"}
        error={signOutError}
        onConfirm={signOutOthers}
        onClose={() => setSigningOut(false)}
      />
    </>
  );
}
