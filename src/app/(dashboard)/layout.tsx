import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { KeepSignedIn } from "@/components/keep-signed-in";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { requireUser } from "@/lib/access";

// The dashboard is always dark, in the editor's colors. This asks the Dark Reader browser extension to leave it alone,
// and the color scheme tells the browser's own dark mode the same (and darkens the page behind it, see globals.css).
export const metadata: Metadata = { other: { "darkreader-lock": "true" } };
export const viewport: Viewport = { colorScheme: "dark" };

// The dashboard's own frame: a header with the person's account menu, and the page filling the rest of the window.
// Admin shares this frame; sign-in keeps the (auth) look.
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <div className="ed-theme flex h-dvh flex-col bg-ed-bg font-sans text-ed-text">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-ed-line bg-ed-panel px-4">
        {/* The wordmark leads back to the projects, from Admin too. The negative margin keeps it where the plain text was. */}
        <Link
          href="/dashboard"
          className={cx("-mx-1.5 rounded-md px-1.5 py-0.5 text-sm font-semibold hover:bg-ed-hover", FOCUS_RING, FADE)}
        >
          EasyEdit
        </Link>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {user.allowlistRole === "admin" && (
            <Link
              href="/admin"
              className={cx("rounded-md px-2 py-1 text-xs font-medium text-ed-muted hover:bg-ed-hover hover:text-ed-text", FOCUS_RING, FADE)}
            >
              Admin
            </Link>
          )}
          <AccountMenu name={user.name || user.email} image={user.image ?? null} />
        </div>
      </header>
      <KeepSignedIn />
      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  );
}
