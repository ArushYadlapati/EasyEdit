import type { Metadata, Viewport } from "next";
import { DARK_READER_LOCK_WHEN_DARK } from "@/lib/color-scheme";
import { FONT_VARIABLE_CLASSES } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "EasyEdit",
  description: "Video editor for the Seattle Solvers FTC team.",
};

// <meta name="color-scheme">: pages follow the computer's light or dark setting, and the editor and the dashboard
// override this with "dark". A browser's own "force dark" mode (Chrome's, Edge's, Samsung Internet's) leaves alone a
// page that says it has dark colors, and the page background in globals.css follows this value too.
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
