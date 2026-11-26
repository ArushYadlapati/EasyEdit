import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { SITE_METADATA, SITE_VIEWPORT, SitePage } from "@/components/site/site-page";
import { getCurrentUser } from "@/lib/access";
import { START_PATH } from "@/lib/home/first-project";
import { loginHref } from "@/lib/home/safe-next";
import { startProjectAction } from "./actions";
import { StartProject } from "./start-project";

// Where sign-in carries on to after the home page's Create project: the project asked for there (kept in this tab, see
// lib/home/first-project.ts) is made and opened in the editor. Anyone who comes here without one goes on to their
// projects. In the public site's frame, like the sign-in page it follows.
export const metadata: Metadata = { ...SITE_METADATA, title: "New project · EasyEdit", robots: { index: false } };
export const viewport: Viewport = SITE_VIEWPORT;

export default async function NewProjectPage() {
  // Decided by the allowlist, not by cookie presence, as on the sign-in page.
  if (!(await getCurrentUser())) redirect(loginHref(START_PATH));
  return (
    <SitePage>
      <main className="h-plain">
        <div className="h-plainColumn">
          <StartProject action={startProjectAction} />
        </div>
      </main>
    </SitePage>
  );
}
