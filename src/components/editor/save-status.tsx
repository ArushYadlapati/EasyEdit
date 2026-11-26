"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { holdsEdit } from "@/lib/editor/held-edit";
import { saveStatusLabel } from "@/lib/editor/messages";
import { useEditor } from "./context";

// Whether the browser says it is online, kept current by its online and offline events. The server's render takes it
// as online.
function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

export function SaveStatus() {
  const status = useEditor((s) => s.status);
  const pending = useEditor((s) => s.queue.length);
  const limitMessage = useEditor((s) => s.limitMessage);
  const canEdit = useEditor((s) => s.canEdit);
  const moved = useEditor((s) => s.moved);
  const held = useEditor(holdsEdit); // words still being typed, say: on screen, not sent yet
  const online = useOnline();
  // Moved: nothing more is saved here, whatever the status was when it stopped. The banner says where to go.
  const label = moved ? "Moved" : saveStatusLabel(status, pending + (held ? 1 : 0), canEdit, limitMessage, held, online);
  const tone =
    moved || status === "offline" || status === "limited" ? "text-ed-warn" : status === "signed-out" ? "text-ed-danger" : "text-ed-muted";

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span role="status" title={label} className={cx("truncate", tone)}>
        {label}
      </span>
      {/* A new tab, so this one keeps the edits that wait to be sent once the person is back. */}
      {status === "signed-out" && !moved && (
        <Link
          href="/login"
          target="_blank"
          rel="noopener"
          className={cx("shrink-0 rounded-[4px] font-medium text-ed-text underline underline-offset-2", FOCUS_RING)}
        >
          Sign in
        </Link>
      )}
    </div>
  );
}
