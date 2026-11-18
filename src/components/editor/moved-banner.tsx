"use client";

import { FolderOutput } from "lucide-react";
import { cx } from "@/components/ui/cx";
import { MOVE_MESSAGES } from "@/lib/projects/move-messages";
import { useEditor } from "./context";
import { LeaveLink } from "./leave-link";
import { NOTICE_FRAME, NOTICE_LAYER, NOTICE_LINK, NOTICE_ROW } from "./notice-bar";

// Across the top of the preview once the project has moved to another space while this tab was open. The project's
// address without a space sends the person on to the space it is in now; a space they are not in gets no link.
// It looks like the notice bar, the same 38 px tall without a Dismiss button, but it stays. The folder mark is in
// the warn color, like "Moved" in the top bar, since editing has stopped here.
export function MovedBanner() {
  const moved = useEditor((s) => s.moved);
  const elsewhere = useEditor((s) => s.movedElsewhere);
  const projectId = useEditor((s) => s.projectId);
  if (!moved) return null;
  return (
    <div className={cx(NOTICE_LAYER, "top-[53px]")}>
      <div className={cx(NOTICE_ROW, NOTICE_FRAME, "py-2 pr-3")}>
        {/* Level with the first line when the message wraps. */}
        <FolderOutput aria-hidden className="mt-0.5 mr-2 size-4 shrink-0 self-start stroke-[1.75] text-ed-warn" />
        <p role="alert" className="min-w-0">
          {elsewhere ? MOVE_MESSAGES.movedAway : MOVE_MESSAGES.moved}
        </p>
        {!elsewhere && (
          <LeaveLink href={`/editor/${projectId}`} className={NOTICE_LINK}>
            Open it there
          </LeaveLink>
        )}
      </div>
    </div>
  );
}
