"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { STYLE_WORDS } from "@/lib/style/messages";

const W = STYLE_WORDS.leave;

// A click on a link that leaves this page as it is: one that opens another tab or window, saves a file, goes to
// another site (the browser asks about that itself, before the page unloads), or goes to a place on this page.
function keepsPage(event: MouseEvent, link: HTMLAnchorElement): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true;
  if ((link.target !== "" && link.target !== "_self") || link.hasAttribute("download")) return true;
  let to: URL;
  try {
    to = new URL(link.href, window.location.href);
  } catch {
    return true; // not an address the app could go to
  }
  const here = window.location;
  return to.origin !== here.origin || (to.pathname === here.pathname && to.search === here.search);
}

// Asks before the page is left while something on it would be lost. reasons: a sentence for each thing that would be
// (empty when nothing would). Closing or reloading the tab gets the browser's own question. A link within the app gets
// this one, with the reasons: Stay, or Leave, which follows the link after all. As in the editor, the listeners are
// there only while something would be lost, since one for beforeunload keeps the browser from holding the page for
// Back. The question goes by itself once there is nothing left to lose.
export function LeaveGuard({ reasons }: { reasons: readonly string[] }): ReactNode {
  const guarding = reasons.length > 0;
  const [asked, setAsked] = useState<HTMLAnchorElement | null>(null);
  const [going, setGoing] = useState<HTMLAnchorElement | null>(null);
  if (asked && !guarding) setAsked(null);
  const leaving = useRef(false); // the person chose Leave: nothing is asked again on the way out

  useEffect(() => {
    if (!guarding) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      event.preventDefault();
      event.returnValue = ""; // what older browsers look for before they ask
    };
    // On the window, as the click starts out: before React (and Next.js's links) hear it at the document.
    const onClick = (event: MouseEvent) => {
      if (leaving.current || event.defaultPrevented) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || keepsPage(event, link)) return;
      event.preventDefault();
      event.stopPropagation();
      setAsked(link);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClick, true);
    };
  }, [guarding]);

  // The link is followed once the question has closed, so the page behind it takes clicks again.
  useEffect(() => {
    if (!going) return;
    leaving.current = true;
    going.click();
  }, [going]);

  function leave() {
    setGoing(asked);
    setAsked(null);
  }

  return (
    <Dialog
      title={W.title}
      open={asked !== null}
      onClose={() => setAsked(null)}
      footer={
        <>
          <Button onClick={() => setAsked(null)}>{W.stay}</Button>
          <Button variant="primary" onClick={leave}>
            {W.leave}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
      </div>
    </Dialog>
  );
}
