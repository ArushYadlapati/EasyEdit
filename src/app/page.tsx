import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { HomePage } from "@/components/home/home-page";
import { getCurrentUser } from "@/lib/access";
import { openSignUp } from "@/lib/signup";

// The home page is always dark, like the editor and the dashboard: it says so to the browser, and tells Dark Reader
// to leave it alone (see src/lib/color-scheme.ts).
export const metadata: Metadata = { other: { "darkreader-lock": "true" } };
export const viewport: Viewport = { colorScheme: "dark" };

// Public: the proxy lets a signed-out visitor through, so this page decides. Decided by the allowlist, not by cookie presence.
export default async function Home() {
  if (await getCurrentUser()) redirect("/dashboard");
  return <HomePage closedBeta={!openSignUp()} />;
}
