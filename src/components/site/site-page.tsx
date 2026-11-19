import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteFooter, type SitePageName } from "./site-footer";
import { SiteHeader } from "./site-header";

// The public pages are always dark, like the editor and the dashboard: each one says so to the browser and tells the
// Dark Reader extension to leave it alone (see src/lib/color-scheme.ts). A page spreads these into its own exports.
export const SITE_METADATA = { other: { "darkreader-lock": "true" } } satisfies Metadata;
export const SITE_VIEWPORT = { colorScheme: "dark" } satisfies Viewport;

// A public page in the site's frame: the header, the page's own <main>, then the footer. The header and footer sit
// outside <main>, so they are the page's banner and contentinfo landmarks. current: which of the pages the header and
// footer link to this one is, so neither offers a link that only reloads it.
export function SitePage({ current, children }: { current?: SitePageName; children: ReactNode }) {
  return (
    <div className="h-site">
      <SiteHeader current={current} />
      {children}
      <SiteFooter current={current} />
    </div>
  );
}
