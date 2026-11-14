"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { PasskeysDialog } from "@/components/dashboard/passkeys-dialog";
import { Menu } from "@/components/ui/menu";
import { authClient } from "@/lib/auth-client";
import { signOutAndLeave } from "@/lib/sign-out";

const noChanges = () => () => {};
const backFromSigningIn = () => new URLSearchParams(window.location.search).get("passkeys") === "1";

// The header's account button: the person's picture and name, opening a menu with Passkeys and Sign out.
export function AccountMenu({ name, image }: { name: string; image: string | null }): ReactNode {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [passkeysOpen, setPasskeysOpen] = useState(false);

  // Signing in again from the Passkeys dialog comes back to ?passkeys=1, which opens it again. The parameter is then
  // taken out of the address, so a reload or a copied link does not open it. The server cannot see it, so hydration
  // renders it closed and the browser opens it right after.
  const reopen = useSyncExternalStore(noChanges, backFromSigningIn, () => false);
  const [reopened, setReopened] = useState(false);
  if (reopen && !reopened) {
    setReopened(true);
    setPasskeysOpen(true);
  }
  useEffect(() => {
    if (!reopen) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("passkeys");
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  }, [reopen, router]);

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
        items={[{ id: "passkeys", label: "Passkeys" }, { id: "sign-out", label: "Sign out" }]}
        onSelect={(id) => {
          if (id === "passkeys") setPasskeysOpen(true);
          if (id === "sign-out") void signOut();
        }}
      />
      <PasskeysDialog open={passkeysOpen} onClose={() => setPasskeysOpen(false)} />
    </div>
  );
}
