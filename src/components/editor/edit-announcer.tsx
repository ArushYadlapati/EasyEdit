"use client";

import { useEffect, useState } from "react";
import { watchEdits } from "@/lib/editor/announce";
import { useEditorStore } from "./context";
import { useMedia } from "./media/media-context";

// A polite live region, seen by nobody, that tells a screen reader what each burst of changes did: yours, a
// teammate's and an AI agent's, in Activity's words. The same sentence twice is still said twice: a trailing
// no-break space comes and goes, so the region's text always changes.
export function EditAnnouncer() {
  const store = useEditorStore();
  const { library } = useMedia();
  const [said, setSaid] = useState({ text: "", odd: false });
  useEffect(
    () => watchEdits(store, (text) => setSaid((last) => ({ text, odd: !last.odd })), { assetName: (id) => library.getState().assets[id]?.name }),
    [store, library],
  );
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {said.text === "" ? "" : `${said.text}${said.odd ? " " : ""}`}
    </div>
  );
}
