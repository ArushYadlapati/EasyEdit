"use client";

import Link from "next/link";
import { useState, type ComponentProps, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { useEditorStore } from "./context";
import { useMedia } from "./media/media-context";

type LeaveLinkProps = Omit<ComponentProps<typeof Link>, "href" | "onClick"> & { href: string };

// The primary button's look, on a link: Button's own classes hover only while enabled, which a link never is.
const PRIMARY_LINK = cx(
  "inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-ed-accent bg-ed-accent px-3 text-xs font-medium whitespace-nowrap text-ed-bg select-none hover:bg-ed-accent/85",
  FOCUS_RING,
  FADE,
);

// A link out of the editor. It navigates inside the app, and the edits still queued are sent
// after the editor closes. When they cannot be sent now (offline, signed out, a send that
// failed), it loads the page for real instead, so the browser asks before they are lost.
// Edits to a project that was deleted can never be saved, so leaving it asks nothing about them.
// Leaving stops the uploads that are running, so while one runs the page is loaded for real too.
// Leaving stops a running export too, so while one runs it asks first, inside the app: Leave then
// navigates inside the app, so the edits still queued are sent rather than cut off by a page load.
export function LeaveLink({ href, ...props }: LeaveLinkProps) {
  const store = useEditorStore();
  const { queue: uploads } = useMedia();
  const [asking, setAsking] = useState(false);

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // A click that opens another tab or window leaves this one as it is.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const { queue, status, exporting } = store.getState();
    const editsAtRisk = queue.length > 0 && status !== "saving" && status !== "deleted";
    if (editsAtRisk || uploads.active() > 0) {
      event.preventDefault();
      window.location.assign(href);
    } else if (exporting) {
      event.preventDefault();
      setAsking(true);
    }
  }

  return (
    <>
      <Link {...props} href={href} onClick={onClick} />
      <Dialog
        title="Leave the editor?"
        open={asking}
        onClose={() => setAsking(false)}
        footer={
          <>
            <Button onClick={() => setAsking(false)}>Stay</Button>
            <Link href={href} className={PRIMARY_LINK}>
              Leave
            </Link>
          </>
        }
      >
        <p>An export is running. Leaving stops it.</p>
      </Dialog>
    </>
  );
}
