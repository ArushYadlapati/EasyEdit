import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { KeepSignedIn } from "@/components/keep-signed-in";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { requireUser } from "@/lib/access";

// The dashboard is always dark, in the editor's colors. This asks the Dark Reader browser extension to leave it alone,
// and the color scheme tells the browser's own dark mode the same (and darkens the page behind it, see globals.css).
export const metadata: Metadata = { other: { "darkreader-lock": "true" } };
export const viewport: Viewport = { colorScheme: "dark" };

// The dashboard's own frame: a header with the person's account menu, and the page filling the rest of the window.
// Admin and sign-in keep the (app) and (auth) looks.
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <div className="ed-theme flex h-dvh flex-col bg-ed-bg font-sans text-ed-text">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-ed-line bg-ed-panel px-4">
        <span className="text-sm font-semibold">EasyEdit</span>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {user.role === "admin" && (
            <Link
              href="/admin"
              className={cx("rounded-md px-2 py-1 text-xs font-medium text-ed-muted hover:bg-ed-hover hover:text-ed-text", FOCUS_RING)}
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
