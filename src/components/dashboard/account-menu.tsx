"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { PasskeysDialog } from "@/components/dashboard/passkeys-dialog";
import { DashboardSettingsDialog } from "@/components/dashboard/settings-dialog";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { authClient } from "@/lib/auth-client";
import { signOutAndLeave } from "@/lib/sign-out";

const noChanges = () => () => {};
// The parameters signing in again from the Passkeys dialog comes back with: its own, and Better Auth's when it failed.
const BACK_PARAMS = ["passkeys", "error", "error_description"];
// null when the address isn't back from signing in again; otherwise the error it came back with, "" for none.
function backFromSigningIn(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("passkeys") === "1" ? (params.get("error") ?? "") : null;
}

// The header's account button: the person's picture and name, opening a menu with Settings, Passkeys, AI agents and
// Sign out. Settings (the editor's General and Shortcuts) is offered on the space pages only: the preferences cookie it
// edits belongs to /s, so the Admin and AI agents pages cannot read it.
export function AccountMenu({ name, image }: { name: string; image: string | null }): ReactNode {
  const router = useRouter();
  const inSpace = (usePathname() ?? "").startsWith("/s/");
  const [failed, setFailed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [passkeysOpen, setPasskeysOpen] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  // Signing in again from the Passkeys dialog comes back to ?passkeys=1, which opens it again, with the error when the
  // sign-in failed. The parameters are then taken out of the address, so a reload or a copied link does not open it.
  // The server cannot see them, so hydration renders it closed and the browser opens it right after.
  const back = useSyncExternalStore(noChanges, backFromSigningIn, () => null);
  const [reopened, setReopened] = useState(false);
  if (back !== null && !reopened) {
    setReopened(true);
    setPasskeysOpen(true);
    setSignInError(back || null);
  }
  useEffect(() => {
    if (back === null) return;
    const url = new URL(window.location.href);
    for (const name of BACK_PARAMS) url.searchParams.delete(name);
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  }, [back, router]);

  async function signOut() {
    setFailed(false);
    const done = await signOutAndLeave({
      signOut: () => authClient.signOut(),
      leave: () => router.push("/login"),
    });
    if (!done) setFailed(true);
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      {failed && (
        <span role="alert" className="text-xs text-ed-danger">
          Couldn&apos;t sign out. Try again.
        </span>
      )}
      <Menu
        label="Account"
        text={name}
        lead={
          image === null ? undefined : (
            // eslint-disable-next-line @next/next/no-img-element -- Google avatar from an arbitrary host; next/image would need a remote pattern.
            <img src={image} alt="" width={20} height={20} referrerPolicy="no-referrer" className="size-5 rounded-full" />
          )
        }
        items={[
          ...(inSpace ? [{ id: "settings", label: "Settings" } satisfies MenuItem] : []),
          { id: "passkeys", label: "Passkeys" },
          { id: "agents", label: "AI agents" },
          { id: "sign-out", label: "Sign out", separatorBefore: true },
        ]}
        onSelect={(id) => {
          if (id === "settings") setSettingsOpen(true);
          if (id === "passkeys") setPasskeysOpen(true);
          if (id === "agents") router.push("/agents");
          if (id === "sign-out") void signOut();
        }}
      />
      {settingsOpen && <DashboardSettingsDialog onClose={() => setSettingsOpen(false)} />}
      <PasskeysDialog
        open={passkeysOpen}
        signInError={signInError}
        onClose={() => {
          setPasskeysOpen(false);
          setSignInError(null);
        }}
      />
    </div>
  );
}
