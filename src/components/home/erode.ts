import localFont from "next/font/local";

// Erode (Indian Type Foundry, from Fontshare, under the ITF Free Font License: free for commercial use and web
// embedding). Served from this site, so the home page asks no third party for its type. Only the home page uses it;
// the app itself stays in Geist.
export const erode = localFont({
  src: [
    { path: "./fonts/erode-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/erode-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/erode-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-erode",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});
