"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { PasskeysDialog } from "@/components/dashboard/passkeys-dialog";
import { DashboardSettingsDialog } from "@/components/dashboard/settings-dialog";
import { TutorialDialog } from "@/components/dashboard/tutorial-dialog";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { authClient } from "@/lib/auth-client";
import { signOutAndLeave } from "@/lib/sign-out";
import type { Lesson } from "@/lib/tutorial/lesson";
import type { TutorialVideo } from "@/lib/tutorial/video";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

const noChanges = () => () => {};
// The parameters signing in again from the Passkeys dialog comes back with: its own, and Better Auth's when it failed.
const BACK_PARAMS = ["passkeys", "error", "error_description"];
// null when the address isn't back from signing in again; otherwise the error it came back with, "" for none.
function backFromSigningIn(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("passkeys") === "1" ? (params.get("error") ?? "") : null;
}

// The address the welcome's last step leads to, which opens New project (see the space's dashboard page).
function makingFirstProject(): boolean {
  return new URLSearchParams(window.location.search).get("new") === "project";
}

// The guide as the server offers it: the first lesson's video, whether this person has yet to be welcomed with it,
// and the action that writes that they have. The lesson itself (its chapters and captions) and the voice's credit
// come only for someone still to be welcomed: nobody else is shown the dialog.
export type AccountTutorial = TutorialVideo & { firstVisit: boolean; markSeen(): Promise<unknown>; lesson?: Lesson; credit?: string | null };

// The header's account button: the person's picture and name, opening a menu with Settings, Passkeys, AI agents,
// Learn and Sign out. Settings (the editor's General and Shortcuts) is offered on the space pages only: the
// preferences cookie it edits belongs to /s, so the Admin and AI agents pages cannot read it. Learn (the guide's
// page) is offered when the server has the videos (tutorial).
// openSignUp: whether anyone may make an account, as the server reads it, for what a refused Google sign-in says.
export function AccountMenu({ name, image, openSignUp = false, tutorial }: { name: string; image: string | null; openSignUp?: boolean; tutorial?: AccountTutorial }): ReactNode {
  const router = useRouter();
  const inSpace = (usePathname() ?? "").startsWith("/s/");
  const [failed, setFailed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [passkeysOpen, setPasskeysOpen] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  // Someone who has not been welcomed gets the guide's first lesson once, by itself, the first time this page load
  // shows a space page: not over Admin or AI agents, where they went on purpose. Playing it or closing it writes the
  // mark, once; from then on the guide is the Learn page, which the menu's Learn goes to. A mark that cannot be
  // written is let go: the dialog comes back next visit.
  // It opens once the page is live in the browser, never in the page as the server sends it: a player in that page
  // would start loading before anything listens to it, and a video that failed to load would go unsaid.
  const live = useSyncExternalStore(noChanges, () => true, () => false);
  // The lesson comes only while the person is still to be welcomed, and writing the mark draws the dashboard's frame
  // again without it. The one that came first is kept, so the welcome stays open, and playing, after its first play.
  const [welcome] = useState(() => (tutorial?.lesson ? { lesson: tutorial.lesson, credit: tutorial.credit ?? null } : null));
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [welcomed, setWelcomed] = useState(false);
  const [seen, setSeen] = useState(false);
  const firstVisit = tutorial?.firstVisit === true && !seen;
  if (live && firstVisit && inSpace && !welcomed) {
    setWelcomed(true);
    // Sent from the welcome to make a first project: New project opens alone, and the lesson waits for the next visit
    // (nothing is marked seen).
    if (!makingFirstProject()) setTutorialOpen(true);
  }
  function markSeen() {
    if (!tutorial || !firstVisit) return;
    setSeen(true);
    void tutorial.markSeen().catch(() => {});
  }

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
          ...(tutorial ? [{ id: "tutorial", label: TUTORIAL_WORDS.learn } satisfies MenuItem] : []),
          { id: "sign-out", label: "Sign out", separatorBefore: true },
        ]}
        onSelect={(id) => {
          if (id === "settings") setSettingsOpen(true);
          if (id === "passkeys") setPasskeysOpen(true);
          if (id === "agents") router.push("/agents");
          if (id === "tutorial") router.push("/learn");
          if (id === "sign-out") void signOut();
        }}
      />
      {settingsOpen && <DashboardSettingsDialog onClose={() => setSettingsOpen(false)} />}
      {tutorial && welcome && (
        <TutorialDialog
          open={tutorialOpen}
          video={tutorial}
          lesson={welcome.lesson}
          credit={welcome.credit}
          firstVisit={firstVisit}
          onWatched={markSeen}
          onClose={() => {
            setTutorialOpen(false);
            markSeen();
          }}
        />
      )}
      <PasskeysDialog
        open={passkeysOpen}
        signInError={signInError}
        openSignUp={openSignUp}
        onClose={() => {
          setPasskeysOpen(false);
          setSignInError(null);
        }}
      />
    </div>
  );
}
