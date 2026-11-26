import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { HomePage } from "@/components/home/home-page";
import { SITE_METADATA, SITE_VIEWPORT } from "@/components/site/site-page";
import { SITE_DESCRIPTION } from "@/lib/home/site-description";
import { getCurrentUser } from "@/lib/access";
import { openSignUp } from "@/lib/signup";

// A shared link to the home page names what EasyEdit is, as the first screen does.
const TITLE = "EasyEdit · The video editor for AI agents, teams and creators";
export const metadata: Metadata = {
  ...SITE_METADATA,
  title: TITLE,
  openGraph: { title: TITLE, description: SITE_DESCRIPTION, siteName: "EasyEdit", type: "website" },
};
// The home page is always dark, like the rest of the public site, the editor and the dashboard: it says so to the
// browser, and tells Dark Reader to leave it alone (see src/lib/color-scheme.ts).
export const viewport: Viewport = SITE_VIEWPORT;

// Public: the proxy lets a signed-out visitor through, so this page decides. Decided by the allowlist, not by cookie presence.
export default async function Home() {
  if (await getCurrentUser()) redirect("/dashboard");
  return <HomePage closedBeta={!openSignUp()} />;
}
