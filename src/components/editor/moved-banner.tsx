"use client";

import { FOCUS_RING, cx } from "@/components/ui/cx";
import { MOVE_MESSAGES } from "@/lib/projects/move-messages";
import { useEditor } from "./context";
import { LeaveLink } from "./leave-link";

// Across the top of the preview once the project has moved to another space while this tab was open. The project's
// address without a space sends the person on to the space it is in now; a space they are not in gets no link.
export function MovedBanner() {
  const moved = useEditor((s) => s.moved);
  const elsewhere = useEditor((s) => s.movedElsewhere);
  const projectId = useEditor((s) => s.projectId);
  if (!moved) return null;
  return (
    <div className="pointer-events-none absolute top-[53px] right-[calc(var(--ed-right-w)+1px)] left-[calc(var(--ed-left-w)+1px)] z-10 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full min-w-0 items-center gap-3 rounded-md border border-ed-line border-l-2 border-l-ed-warn bg-ed-raised px-3 py-1.5 text-[13px] leading-5 text-ed-text">
        <p role="alert" className="min-w-0">
          {elsewhere ? MOVE_MESSAGES.movedAway : MOVE_MESSAGES.moved}
        </p>
        {!elsewhere && (
          <LeaveLink
            href={`/editor/${projectId}`}
            className={cx("shrink-0 rounded-[4px] font-medium text-ed-text underline underline-offset-2", FOCUS_RING)}
          >
            Open it there
          </LeaveLink>
        )}
      </div>
    </div>
  );
}
