"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SignInButton } from "@/app/(auth)/login/sign-in-button";
import { PLAIN_ERROR } from "@/components/ui/cx";
import { LogoMark } from "@/components/ui/logo";
import { authClient } from "@/lib/auth-client";
import { spacePath } from "@/lib/spaces/paths";

type Offer = { inviteId: string; invitedBy: string; teamName: string; roleLabel: string };

// What the page works out on the server; the card draws exactly one.
export type InviteCardState =
  | ({ kind: "signed-out" } & Offer)
  | ({ kind: "join" } & Offer)
  | ({ kind: "wrong-account"; signedInEmail: string } & Offer)
  | { kind: "member"; teamName: string; teamSlug: string }
  | { kind: "unusable"; message: string };

type Result = { error?: string };

const PRIMARY = "flex h-11 w-full items-center justify-center rounded-full bg-foreground px-5 font-medium text-background transition-opacity disabled:opacity-60";
const SECONDARY = "flex h-11 w-full items-center justify-center rounded-full border border-foreground/20 px-5 font-medium transition-opacity disabled:opacity-60";

const invitedLine = (o: Offer) => `${o.invitedBy} invited you to join ${o.teamName} as ${o.roleLabel}.`;

// notice: why a sign-in from this page was refused, shown above the Google button.
export function InviteCard({ state, notice = null, accept, decline }: { state: InviteCardState; notice?: string | null; accept: (inviteId: string) => Promise<Result>; decline: (inviteId: string) => Promise<Result> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // A refusal stays on the card; a success redirects from the server action.
  const call = (action: (inviteId: string) => Promise<Result>, inviteId: string) =>
    start(async () => {
      setError(null);
      const result = await action(inviteId);
      if (result.error) setError(result.error);
    });

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <LogoMark size={56} />
        <h1 className="text-2xl font-semibold tracking-tight">EasyEdit</h1>
        {state.kind === "signed-out" && (
          <>
            <p>{invitedLine(state)}</p>
            {notice !== null && (
              <p role="alert" className={PLAIN_ERROR}>
                {notice}
              </p>
            )}
            <SignInButton callbackURL={`/invite/${state.inviteId}`} errorCallbackURL={`/invite/${state.inviteId}`} />
          </>
        )}
        {state.kind === "join" && (
          <>
            <p>{invitedLine(state)}</p>
            {error !== null && (
              <p role="alert" className={PLAIN_ERROR}>
                {error}
              </p>
            )}
            <button type="button" disabled={pending} onClick={() => call(accept, state.inviteId)} className={PRIMARY}>
              {`Join ${state.teamName}`}
            </button>
            <button type="button" disabled={pending} onClick={() => call(decline, state.inviteId)} className={SECONDARY}>
              Decline
            </button>
          </>
        )}
        {state.kind === "wrong-account" && (
          <>
            <p>{`This invite is for a different email address. You're signed in as ${state.signedInEmail}.`}</p>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await authClient.signOut();
                  router.refresh();
                })
              }
              className={PRIMARY}
            >
              Sign out
            </button>
          </>
        )}
        {state.kind === "member" && (
          <>
            <p>{`You're already in ${state.teamName}.`}</p>
            <Link href={spacePath(state.teamSlug)} className={PRIMARY}>
              {`Open ${state.teamName}`}
            </Link>
          </>
        )}
        {state.kind === "unusable" && (
          <>
            <p>{state.message}</p>
            <Link href="/" className={SECONDARY}>
              Go to EasyEdit
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
