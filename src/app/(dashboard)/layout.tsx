import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { createTeamAction } from "@/app/(dashboard)/s/new/actions";
import { markTutorialSeenAction } from "@/app/(dashboard)/tutorial/actions";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { AdminLink } from "@/components/dashboard/admin-link";
import { SpacesProvider } from "@/components/dashboard/space-switcher";
import { KeepSignedIn } from "@/components/keep-signed-in";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { LogoMark } from "@/components/ui/logo";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { canCreateTeam } from "@/lib/spaces/create-team-access";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { listMyInvites } from "@/lib/spaces/invites";
import { listMySpaces } from "@/lib/spaces/service";
import { openSignUp } from "@/lib/signup";
import { hasSeenTutorial } from "@/lib/tutorial/seen";
import { tutorialVideo } from "@/lib/tutorial/video";

// The dashboard is always dark, in the editor's colors. This asks the Dark Reader browser extension to leave it alone,
// and the color scheme tells the browser's own dark mode the same (and darkens the page behind it, see globals.css).
export const metadata: Metadata = { other: { "darkreader-lock": "true" } };
export const viewport: Viewport = { colorScheme: "dark" };

// The dashboard's own frame: a header with the person's account menu, and the page filling the rest of the window.
// Admin shares this frame; sign-in keeps the (auth) look. The person's spaces reach the header too, which shows Admin
// only in Seattle Solvers (AdminLink). When the server has the intro tutorial's video, the account menu is told
// whether this person has yet to see it; the menu opens it for them once and offers it from then on.
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const db = getDb();
  const video = tutorialVideo();
  // The tutorial is an extra: if its marks cannot be read (the setting was switched on before the table was made),
  // the dashboard opens without the welcome rather than not at all.
  const [spaces, myInvites, seenTutorial] = await Promise.all([
    listMySpaces(db, user.id),
    listMyInvites(db, user.email),
    video ? hasSeenTutorial(db, user.id).catch(() => true) : true,
  ]);
  // Only what the sidebar shows of each invite: where it leads and the team's name.
  const invites = myInvites.map(({ id, teamName }) => ({ id, teamName }));
  const tutorial = video ? { ...video, firstVisit: !seenTutorial, markSeen: markTutorialSeenAction } : undefined;

  return (
    <SpacesProvider spaces={spaces} createTeam={canCreateTeam(spaces) ? createTeamAction : undefined} personalSoon={!personalSpacesOpen()} invites={invites}>
      <div className="ed-theme flex h-dvh flex-col bg-ed-bg font-sans text-ed-text">
        <header className="flex h-11 shrink-0 items-center gap-4 border-b border-ed-line bg-ed-panel px-4">
          {/* The logo and name lead back to the projects, from Admin too. The negative margin keeps them where the plain text was. */}
          <Link
            href="/dashboard"
            className={cx("-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-0.5 text-sm font-semibold hover:bg-ed-hover", FOCUS_RING, FADE)}
          >
            <LogoMark size={18} />
            EasyEdit
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {user.allowlistRole === "admin" && <AdminLink />}
            <AccountMenu name={user.name || user.email} image={user.image ?? null} openSignUp={openSignUp()} tutorial={tutorial} />
          </div>
        </header>
        <KeepSignedIn />
        <div className="flex min-h-0 flex-1">{children}</div>
      </div>
    </SpacesProvider>
  );
}
