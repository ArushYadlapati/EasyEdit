import { LAYOUT_COOKIE, formatLayout, type Layout } from "@/lib/editor/layout";

const YEAR_SECONDS = 31_536_000;

// Keeps the panel sizes in this browser for every editor page, where the server reads them before it paints. Only
// editor pages get the cookie, so API requests do not carry it. A browser that refuses cookies keeps the sizes for
// this page only.
export function writeLayoutCookie(layout: Layout): void {
  try {
    document.cookie = `${LAYOUT_COOKIE}=${formatLayout(layout)}; path=/editor; max-age=${YEAR_SECONDS}; samesite=lax`;
  } catch {
    // Cookies are blocked here.
  }
}
