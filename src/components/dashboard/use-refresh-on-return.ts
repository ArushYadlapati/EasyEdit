"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

// The bfcacheId of every dashboard already shown in this tab. A push to the dashboard gives it a new id, while Back
// through the app's router brings an old one back with the page as it was left.
const shown = new Set<string>();

// Fetches the dashboard's data again when it comes back into view, so the project just left is first in Recent: once
// when it is shown again under an id already seen (Back from the editor through the app's router), and once when the
// browser restores it from its back-forward cache (Back after the editor's full-page leave). A first load, React's
// second effect run in StrictMode and a folder click (which keeps the id) fetch nothing.
export function useRefreshOnReturn(): void {
  const router = useRouter();
  const { bfcacheId } = router;
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    if (shown.has(bfcacheId)) router.refresh();
    else shown.add(bfcacheId);
  }, [router, bfcacheId]);

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) router.refresh();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);
}
