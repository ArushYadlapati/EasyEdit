"use client";

import Link from "next/link";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { holdsEdit } from "@/lib/editor/held-edit";
import { saveStatusLabel } from "@/lib/editor/messages";
import { useEditor } from "./context";

export function SaveStatus() {
  const status = useEditor((s) => s.status);
  const pending = useEditor((s) => s.queue.length);
  const limitMessage = useEditor((s) => s.limitMessage);
  const canEdit = useEditor((s) => s.canEdit);
  const moved = useEditor((s) => s.moved);
  const held = useEditor(holdsEdit); // words still being typed, say: on screen, not sent yet
  // Moved: nothing more is saved here, whatever the status was when it stopped. The banner says where to go.
  const label = moved ? "Moved" : saveStatusLabel(status, pending + (held ? 1 : 0), canEdit, limitMessage, held);
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
