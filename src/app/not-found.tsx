import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SITE_METADATA, SITE_VIEWPORT, SitePage } from "@/components/site/site-page";

// An address that matches no page lands here, signed in or not. A signed-in page that calls notFound() (a project or
// space that doesn't exist, or that this person can't see) shows the app's own page instead, with the way back to their
// projects: see app/(dashboard)/not-found.tsx and app/(editor)/not-found.tsx. Without this file Next shows its own bare
// page, in a system font and pure black or white, with none of EasyEdit's look. It is a page of the public site, in its
// frame; "/" sends a signed-in person on to the dashboard and shows everyone else the home page, and the sign-in page
// sends a signed-in person straight on too.
export const metadata: Metadata = { ...SITE_METADATA, title: "Page not found · EasyEdit" };
export const viewport: Viewport = SITE_VIEWPORT;

export default function NotFound() {
  return (
    <SitePage>
      <main className="h-plain">
        <div className="h-plainColumn">
          <h1 className="h-plainTitle">Page not found</h1>
          <p className="h-plainLead">There&apos;s no page at this address. Check the link, or start from the home page.</p>
          <div className="h-plainActions">
            <Link href="/" className="h-btn">
              Go to the home page
            </Link>
            <Link href="/login" className="h-btn h-btnGhost">
              Sign in
            </Link>
          </div>
        </div>
      </main>
    </SitePage>
  );
}
