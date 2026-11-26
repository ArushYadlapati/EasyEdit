import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { WelcomeAgents } from "@/components/onboarding/welcome-agents";
import { Button } from "@/components/ui/button";
import { linkButtonClass } from "@/components/ui/button-class";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { mcpResourceUrl } from "@/lib/connector/config";
import { welcomePlan, type WelcomeStep } from "@/lib/onboarding/steps";
import { ensurePersonalSpace } from "@/lib/spaces/service";
import { personalSpaceId } from "@/lib/spaces/types";
import { StorageNote } from "@/components/storage/storage-banner";
import { connectHref, settingsNote, SETUP_CARD, STORAGE_MESSAGES } from "@/lib/storage/messages";
import { finishOnboardingAction } from "./actions";

export const metadata: Metadata = { title: "Welcome" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// The first visit of a new account: where videos live, then AI agents. The steps are worked out here on the server;
// a missing or unknown `step` is the first one. It never redirects to /dashboard (which sends new accounts here).
export default async function WelcomePage({ searchParams }: PageProps<"/welcome">): Promise<ReactNode> {
  const me = await requireUser();
  const db = getDb();
  const query = await searchParams;
  await ensurePersonalSpace(db, me);
  // What a connect started here came back with (?storage=<note>): said on the storage step, before moving on.
  const told = first(query.storage);
  const note = settingsNote(told);
  const { steps, team, connected } = await welcomePlan(db, me.id, first(query.team), { justConnected: told === "connected" });
  const asked = first(query.step);
  const step: WelcomeStep = steps.find((s) => s === asked) ?? steps[0];
  const number = steps.indexOf(step) + 1;
  const teamSlug = team?.slug ?? "";
  const agentsHref = `/welcome?${new URLSearchParams({ step: "agents" }).toString()}`;
  // Every connect from here comes back to this step, worked or not.
  const storageHref = `/welcome?${new URLSearchParams({ step: "storage" }).toString()}`;
  const personalId = personalSpaceId(me.id);
  // The Google account just tried already holds another space: choosing a different one is the way on.
  const differentFirst = told === "account-in-use";

  const skipSetup = (
    <form action={finishOnboardingAction}>
      <input type="hidden" name="team" value={teamSlug} />
      <button
        type="submit"
        className={cx("rounded-sm text-xs text-ed-muted underline-offset-2 hover:text-ed-text hover:underline", FOCUS_RING, FADE)}
      >
        Skip setup
      </button>
    </form>
  );

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-col items-start gap-1">
          <h1 className="text-base font-semibold">Welcome to EasyEdit</h1>
          {steps.length > 1 && (
            <p className="text-xs text-ed-muted">
              Step {number} of {steps.length}
            </p>
          )}
        </header>

        {step === "storage" ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold">{SETUP_CARD.personalTitle}</h2>
            <p className="text-[13px] leading-5 text-ed-text">{STORAGE_MESSAGES.why}</p>
            {connected ? (
              <>
                {note && <StorageNote note={note} />}
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={agentsHref} className={linkButtonClass("primary")}>
                    Continue
                  </Link>
                </div>
              </>
            ) : (
              <>
                {note && told !== "connected" && <StorageNote note={note} />}
                {/* Said before any account is picked: one Google account holds one space's uploads. */}
                <p className="text-[13px] leading-5 text-ed-text">
                  {STORAGE_MESSAGES.oneAccountOneSpace} {STORAGE_MESSAGES.forATeam}
                </p>
                <p className="text-[13px] leading-5 text-ed-muted">{STORAGE_MESSAGES.signedInAs(me.email)}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={connectHref(personalId, { signedInAccount: true, returnTo: storageHref })}
                    className={linkButtonClass(differentFirst ? undefined : "primary")}
                  >
                    {STORAGE_MESSAGES.connectDrive}
                  </a>
                  <a href={connectHref(personalId, { returnTo: storageHref })} className={linkButtonClass(differentFirst ? "primary" : undefined)}>
                    {STORAGE_MESSAGES.chooseDifferent}
                  </a>
                  <Link href={agentsHref} className={linkButtonClass()}>
                    Skip for now
                  </Link>
                </div>
              </>
            )}
          </section>
        ) : (
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold">Use EasyEdit with your AI agent</h2>
            <p className="text-[13px] leading-5 text-ed-muted">
              Connect Claude, ChatGPT or another agent to make and edit videos by asking. You can do this any time from AI
              agents in your account menu.
            </p>
            <WelcomeAgents url={mcpResourceUrl()} />
            <form action={finishOnboardingAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="team" value={teamSlug} />
              <Button type="submit" variant="primary">
                Finish
              </Button>
              <Button type="submit">Skip</Button>
            </form>
          </section>
        )}

        <div>{skipSetup}</div>
      </div>
    </main>
  );
}
