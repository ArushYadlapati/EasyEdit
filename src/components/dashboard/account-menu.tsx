"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu } from "@/components/ui/menu";
import { authClient } from "@/lib/auth-client";
import { signOutAndLeave } from "@/lib/sign-out";

// The header's account button: the person's picture and name, opening a menu with AI agents and Sign out.
export function AccountMenu({ name, image }: { name: string; image: string | null }): ReactNode {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setFailed(false);
    const done = await signOutAndLeave({
      signOut: () => authClient.signOut(),
      leave: () => router.push("/login"),
    });
    if (!done) setFailed(true);
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
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
          { id: "agents", label: "AI agents" },
          { id: "sign-out", label: "Sign out", separatorBefore: true },
        ]}
        onSelect={(id) => {
          if (id === "agents") router.push("/agents");
          if (id === "sign-out") void signOut();
        }}
      />
    </span>
  );
}
