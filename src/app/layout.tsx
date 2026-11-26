import type { Metadata, Viewport } from "next";
import { DARK_READER_LOCK_WHEN_DARK } from "@/lib/color-scheme";
import { SITE_DESCRIPTION } from "@/lib/home/site-description";
import { FONT_VARIABLE_CLASSES } from "./fonts";
import "./globals.css";

const DESCRIPTION = SITE_DESCRIPTION;

// Link previews (Discord, Slack, iMessage) read the Open Graph tags first, so they carry the same text, with the
// picture in opengraph-image.tsx shown large.
export const metadata: Metadata = {
  // Link previews' picture addresses are absolute: on this site's own address (production sets BETTER_AUTH_URL to it).
  metadataBase: new URL(process.env.BETTER_AUTH_URL ?? "https://easyedit.arush.dev"),
  title: "EasyEdit",
  description: DESCRIPTION,
  openGraph: { title: "EasyEdit", description: DESCRIPTION, siteName: "EasyEdit", type: "website" },
  twitter: { card: "summary_large_image" },
};

// <meta name="color-scheme">: pages follow the computer's light or dark setting, and the editor, the dashboard and the
// public site (home, sign-in, terms, privacy, page not found) override this with "dark". A browser's own "force dark"
// mode (Chrome's, Edge's, Samsung Internet's) leaves alone a page that says it has dark colors, and the page background
// in globals.css follows this value too.
export const viewport: Viewport = { colorScheme: "light dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions that add attributes to <html> otherwise cause a hydration warning.
    <html
      suppressHydrationWarning
      lang="en"
      className={`${FONT_VARIABLE_CLASSES} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: DARK_READER_LOCK_WHEN_DARK }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
