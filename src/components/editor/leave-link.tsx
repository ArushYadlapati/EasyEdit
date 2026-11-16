"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ComponentProps, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { useEditor, useEditorStore } from "./context";
import { useMedia } from "./media/media-context";

type LeaveLinkProps = Omit<ComponentProps<typeof Link>, "href" | "onClick" | "ref"> & { href: string };

// How long a click out of the editor waits for a save in flight before it loads the page for real instead.
export const LEAVE_SETTLE_MS = 4000;

// The primary button's look, on a link: Button's own classes hover only while enabled, which a link never is.
const PRIMARY_LINK = cx(
  "inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-ed-accent bg-ed-accent px-3 text-xs font-medium whitespace-nowrap text-ed-bg select-none hover:bg-ed-accent/85",
  FOCUS_RING,
  FADE,
);

// A link out of the editor. It navigates inside the app, and the edits still queued are sent
// after the editor closes. When they cannot be sent now (offline, signed out, a send that
// failed), it loads the page for real instead, so the browser asks before they are lost.
// While a save is in flight the click waits for it, up to LEAVE_SETTLE_MS: a send that fails after the editor closed
// would stop the sync and drop the edits with no word. Once the save worked the link is clicked again, inside the app;
// when it failed, or is still going at the cap, the page is loaded for real instead.
// Edits to a project that was deleted can never be saved, so leaving it asks nothing about them.
// Leaving stops the uploads that are running, so while one runs the page is loaded for real too.
// Leaving stops a running export too, so while one runs it asks first, inside the app: Leave then
// navigates inside the app, so the edits still queued are sent rather than cut off by a page load.
// A finished export waiting for its Download is asked about the same way, and the question's sentence follows the store
// as it is now: a file waiting for Download once the export has ended, a running export otherwise.
export function LeaveLink({ href, ...props }: LeaveLinkProps) {
  const store = useEditorStore();
  const { queue: uploads } = useMedia();
  const [asking, setAsking] = useState(false);
  const running = useEditor((s) => s.exporting);
  const held = useEditor((s) => s.exportHeld);
  // The question is there only while there is still something to stop or to lose. Once there is not, it is gone for
  // good, so a later export does not bring it back by itself.
  if (asking && !running && !held) setAsking(false);
  const linkRef = useRef<HTMLAnchorElement>(null);
  // The wait for a save in flight, at most one at a time: what ends it early.
  const waiting = useRef<(() => void) | null>(null);

  function stopWaiting() {
    waiting.current?.();
    waiting.current = null;
  }
  useEffect(() => stopWaiting, []);

  // A click that opens another tab or window leaves this one as it is.
  const newTab = (event: MouseEvent<HTMLAnchorElement>) =>
    event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

  // Edits that cannot be sent now, or uploads that leaving stops: the page is loaded for real, so the browser asks.
  // Both the link and Leave apply it, Leave again at its own click, as the edits may have become at risk meanwhile.
  function loadsForReal(event: MouseEvent<HTMLAnchorElement>): boolean {
    const { queue, status } = store.getState();
    const editsAtRisk = queue.length > 0 && status !== "saving" && status !== "deleted";
    if (!editsAtRisk && uploads.active() === 0) return false;
    event.preventDefault();
    window.location.assign(href);
    return true;
  }

  // A save in flight: the click is held back until the save ends, then the link that was clicked is clicked again, so
  // the checks above run on how it ended. A click during the wait does nothing more.
  function waitsForSave(event: MouseEvent<HTMLAnchorElement>): boolean {
    if (waiting.current) {
      event.preventDefault();
      return true;
    }
    const sending = (s: { queue: unknown[]; status: string }) => s.queue.length > 0 && s.status === "saving";
    if (!sending(store.getState())) return false;
    event.preventDefault();
    const clicked = event.currentTarget;
    const settle = () => {
      stopWaiting();
      if (sending(store.getState())) window.location.assign(href); // still going at the cap
      else (clicked.isConnected ? clicked : linkRef.current)?.click();
    };
    const unsubscribe = store.subscribe((s) => {
      if (!sending(s)) settle();
    });
    const timer = setTimeout(settle, LEAVE_SETTLE_MS);
    waiting.current = () => {
      unsubscribe();
      clearTimeout(timer);
    };
    return true;
  }

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (newTab(event) || loadsForReal(event)) return;
    const { exporting, exportHeld } = store.getState();
    if (exporting || exportHeld) {
      event.preventDefault();
      if (!waiting.current) setAsking(true);
      return;
    }
    waitsForSave(event);
  }

  function onLeave(event: MouseEvent<HTMLAnchorElement>) {
    if (!newTab(event) && !loadsForReal(event)) waitsForSave(event);
  }

  function stay() {
    stopWaiting();
    setAsking(false);
  }

  return (
    <>
      <Link {...props} ref={linkRef} href={href} onClick={onClick} />
      <Dialog
        title="Leave the editor?"
        open={asking && (running || held)}
        onClose={stay}
        footer={
          <>
            <Button onClick={stay}>Stay</Button>
            <Link href={href} className={PRIMARY_LINK} onClick={onLeave}>
              Leave
            </Link>
          </>
        }
      >
        <p>
          {held && !running
            ? "Your exported video hasn't been downloaded. Leaving discards it."
            : "An export is running. Leaving stops it."}
        </p>
      </Dialog>
    </>
  );
}
