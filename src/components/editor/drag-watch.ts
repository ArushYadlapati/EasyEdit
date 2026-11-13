import { dragKind, type Incoming, type MediaDrop } from "@/lib/editor/media-drop";

const TYPES = ["dragstart", "dragenter", "dragover", "dragleave", "drop", "dragend"] as const;

// Tells `drop` what is dragged over the window: files from the computer, or a library item of this page. The listeners
// are in the capture phase, so they run before any element's handler: a drop handler works from its own event, never
// from `incoming` or `asset`, which this may already have cleared.
//
// There is no count of enters and leaves. The elements entered are kept in a set instead, and one that has left the
// page is forgotten: a browser sends no dragleave for an element removed under the pointer (the left panel's Text tab,
// once it switches to Media), so a count would stay above zero for good. As a last resort, a drag that sends nothing
// for idleMs has gone: browsers send dragover every few hundred milliseconds while one is over the page.
//
// allowed: whether this person may drop anything now; while it is false nothing is set. While a dialog is open the
// page behind it is inert: no drag starts or comes in, though one that leaves, drops or ends still goes.
export function watchDrags(win: Window, drop: MediaDrop, allowed: () => boolean, idleMs = 1000): () => void {
  const entered = new Set<EventTarget>();
  let fromPage = false; // the drag began in the page: an image or a link of the page is no file from the computer
  let idle: ReturnType<typeof setTimeout> | null = null;

  const dialogOpen = () => win.document.querySelector("dialog[open]") !== null;

  const kindOf = (event: DragEvent): Incoming => {
    const kind = dragKind([...(event.dataTransfer?.types ?? [])], drop.state.getState().asset !== null);
    if (kind === "asset") return "asset";
    if (kind === "files" && !fromPage) return "files";
    return null;
  };

  const prune = () => {
    for (const target of entered) if (target instanceof Node && !target.isConnected) entered.delete(target);
  };

  const stopIdle = () => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
  };

  // The drag is over: the drop, the idle wait, or the end of the drag. The library item is kept until its drag ends.
  const clear = () => {
    stopIdle();
    entered.clear();
    fromPage = false;
    drop.setIncoming(null);
  };

  const rearm = () => {
    stopIdle();
    idle = setTimeout(clear, idleMs);
  };

  const onDragStart = () => {
    if (dialogOpen()) return;
    fromPage = true;
  };

  const onDragEnter = (event: DragEvent) => {
    if (dialogOpen()) return;
    rearm();
    const kind = kindOf(event);
    if (kind === null || !allowed() || event.target === null) return;
    prune();
    entered.add(event.target);
    drop.setIncoming(kind);
  };

  const onDragOver = (event: DragEvent) => {
    if (dialogOpen()) return;
    rearm();
    const kind = kindOf(event);
    if (kind === null || !allowed() || event.target === null) return;
    // After an idle clear the set is empty while the drag goes on: this target brings it back.
    prune();
    if (entered.size === 0) entered.add(event.target);
    drop.setIncoming(kind);
  };

  const onDragLeave = (event: DragEvent) => {
    if (event.target === null) return;
    prune();
    entered.delete(event.target);
    if (entered.size === 0) drop.setIncoming(null);
  };

  const onDragEnd = () => {
    clear();
    drop.endAssetDrag();
  };

  const listeners: Record<(typeof TYPES)[number], (event: DragEvent) => void> = {
    dragstart: onDragStart,
    dragenter: onDragEnter,
    dragover: onDragOver,
    dragleave: onDragLeave,
    drop: clear,
    dragend: onDragEnd,
  };
  for (const type of TYPES) win.addEventListener(type, listeners[type], true);
  return () => {
    for (const type of TYPES) win.removeEventListener(type, listeners[type], true);
    stopIdle();
  };
}
