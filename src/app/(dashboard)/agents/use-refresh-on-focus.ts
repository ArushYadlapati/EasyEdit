"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// At most one refresh this often, however many focus and visibility events come at once (both fire on returning).
const GAP_MS = 2000;

// Reads the page's data again when the person comes back to this tab, as they do after connecting an agent in the
// agent's own app, so the connection shows without a reload. Nothing is fetched on the first load.
export function useRefreshOnFocus(): void {
  const router = useRouter();
  useEffect(() => {
    let last = 0;
    function refresh() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < GAP_MS) return;
      last = now;
      router.refresh();
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
}
