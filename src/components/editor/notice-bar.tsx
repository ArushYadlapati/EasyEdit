"use client";

import { X } from "lucide-react";
import { useEffect, useReducer, useRef } from "react";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { useEditor } from "./context";
import { LeaveLink } from "./leave-link";

// How long an info notice stays once nothing holds it.
export const NOTICE_MS = 5000;

const isInternalPath = (href: string) => href.startsWith("/") && !href.startsWith("//");

// The looks shared by everything said over the preview: this bar, and the moved banner at the top. The layer spans the
// preview between the side panels and lets clicks through around the notice; each one adds its own top or bottom.
export const NOTICE_LAYER =
  "pointer-events-none absolute right-[calc(var(--ed-right-w)+1px)] left-[calc(var(--ed-left-w)+1px)] z-10 flex justify-center px-4";
export const NOTICE_ROW = "flex max-w-full min-w-0 items-center text-[13px] leading-5 text-ed-text";
// The frame: one raised line with a hairline edge. A tone, such as an error, colors the words or a small mark beside
// them, never a stripe down the side.
export const NOTICE_FRAME = "pointer-events-auto rounded-md border border-ed-line bg-ed-raised pl-3";
export const NOTICE_LINK = cx("ml-2 shrink-0 rounded-[4px] font-medium underline underline-offset-2", FOCUS_RING);

// The latest notice, centered over the preview just above the timeline. An info notice goes away after five seconds,
// counted again in full for every new notice. The count waits while the pointer is over the notice or focus is in it,
// so the words, and a link in them, don't go while someone reads them or reaches for them; it starts again from the
// top once both have left. An error stays until it is dismissed or a newer notice takes its place.
export function NoticeBar() {
  const notice = useEditor((s) => s.notice);
  const dismiss = useEditor((s) => s.dismissNotice);
  const noticeId = notice?.id;
  const error = notice?.tone === "error";

  const row = useRef<HTMLDivElement>(null);
  // Whether the pointer is over the notice, and whether focus is in it; either one holds the count, a newer notice's
  // too when it arrives under a pointer that is still there or with focus still on Dismiss.
  const pointerOver = useRef(false);
  const focusIn = useRef(false);
  // Bumped whenever the pointer or focus comes or goes, so the count is looked at again.
  const [moves, moved] = useReducer((n: number) => n + 1, 0);

  // The pointer and focus are followed across the whole page rather than through the bar's own enter and leave, which
  // don't come when what they were on is taken away under them, such as the link's question closing. Over or into
  // anything says where they are now; out to nothing (out of the window, a touch that ended, focus dropped) says
  // they have left.
  useEffect(() => {
    const inBar = (target: EventTarget | null) => target instanceof Node && (row.current?.contains(target) ?? false);
    const follow = (held: { current: boolean }, now: boolean) => {
      if (held.current === now) return;
      held.current = now;
      moved();
    };
    const over = (event: PointerEvent) => follow(pointerOver, inBar(event.target));
    const out = (event: PointerEvent) => {
      if (event.relatedTarget === null) follow(pointerOver, false);
    };
    const focus = (event: FocusEvent) => follow(focusIn, inBar(event.target));
    const blur = (event: FocusEvent) => {
      if (event.relatedTarget === null) follow(focusIn, false);
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", blur, true);
    return () => {
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", blur, true);
    };
  }, []);

  // A new notice, or none: what holds it is read from the page again. A focused link that goes with its notice takes
  // focus with it, and not every browser sends a blur for that; without a notice there is no frame left to be over.
  useEffect(() => {
    focusIn.current = row.current?.contains(document.activeElement) ?? false;
    if (noticeId === undefined) pointerOver.current = false;
  }, [noticeId]);

  useEffect(() => {
    if (noticeId === undefined || error || pointerOver.current || focusIn.current) return;
    const timer = setTimeout(dismiss, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [noticeId, error, moves, dismiss]);

  // The two live regions stay mounted, empty without a notice, so a screen reader announces the
  // text when it arrives. Each notice's words are a node of their own, so a notice that says the
  // same as the one still showing, such as a retry that is refused again, is announced too. The
  // bar's frame and the Dismiss button appear only with a notice.
  return (
    <div className={cx(NOTICE_LAYER, "bottom-[calc(var(--ed-timeline-h)+9px)]")}>
      <div ref={row} className={cx(NOTICE_ROW, notice && cx(NOTICE_FRAME, "py-1 pr-1"))}>
        {/* An error is said in the danger color, as everywhere else in the app. */}
        <p role="alert" className="min-w-0 text-ed-danger">
          {error && <span key={notice.id}>{notice.text}</span>}
        </p>
        <p role="status" className="min-w-0">
          {notice && !error && <span key={notice.id}>{notice.text}</span>}
        </p>
        {/* A way out of the editor, so it goes through LeaveLink like the others; only a path of this app is taken. */}
        {notice?.link && isInternalPath(notice.link.href) && (
          <LeaveLink href={notice.link.href} className={NOTICE_LINK}>
            {notice.link.label}
          </LeaveLink>
        )}
        {notice && (
          <IconButton label="Dismiss" className="ml-2" onClick={() => dismiss()}>
            <X />
          </IconButton>
        )}
      </div>
    </div>
  );
}
