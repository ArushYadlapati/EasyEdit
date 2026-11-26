"use client";

import { Check, CircleAlert, CloudOff, CloudUpload, FolderOutput, Trash2, Users } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { MESSAGES, saveStatusLabel } from "@/lib/editor/messages";
import { useEditor } from "./context";
import { usePresence } from "./presence-context";

// The narrow top bar's forms of the save status and of who else is here, for a window under the lg width. Neither is
// a live region or a control of its own: the top bar keeps one SaveStatus and one EditingIndicator at every width,
// whose words a screen reader hears, and only their look changes here.

type Mark = { icon: ReactNode; word: string | null; tone: string };

const ICON = "size-3.5 shrink-0 stroke-2";

// What the save status shows in a narrow window: a mark on its own while all is well, and a short word beside it once
// something needs the person to know (offline, not saved yet, signed out, moved, deleted), in the colors SaveStatus
// uses for the same states.
function markOf(status: string, moved: boolean, label: string): Mark {
  if (moved) return { icon: <FolderOutput className={ICON} />, word: "Moved", tone: "text-ed-warn" };
  switch (status) {
    case "saving":
      return { icon: <CloudUpload className={ICON} />, word: null, tone: "text-ed-muted" };
    case "offline":
      return { icon: <CloudOff className={ICON} />, word: "Offline", tone: "text-ed-warn" };
    case "limited":
      return { icon: <CircleAlert className={ICON} />, word: "Not saved yet", tone: "text-ed-warn" };
    case "signed-out":
      return { icon: <CircleAlert className={ICON} />, word: "Signed out", tone: "text-ed-danger" };
    case "deleted":
      return { icon: <Trash2 className={ICON} />, word: label, tone: "text-ed-muted" };
    default:
      return { icon: <Check className={ICON} />, word: null, tone: "text-ed-muted" };
  }
}

// The save status as a mark (and a word when it matters), with its full words in the pointer's tooltip. Hidden from
// screen readers: SaveStatus beside it says the same in words, and is announced. The word is drawn from data-word, not
// written in the page, so the page holds the status's words once, where they are announced.
export function SaveMark({ className }: { className?: string }) {
  const status = useEditor((s) => s.status);
  const pending = useEditor((s) => s.queue.length);
  const limitMessage = useEditor((s) => s.limitMessage);
  const canEdit = useEditor((s) => s.canEdit);
  const moved = useEditor((s) => s.moved);
  const label = moved ? "Moved" : saveStatusLabel(status, pending, canEdit, limitMessage);
  const { icon, word, tone } = markOf(status, moved, label);
  return (
    <span
      aria-hidden
      data-save-mark={moved ? "moved" : status}
      title={label}
      data-word={word ?? undefined}
      className={cx(
        "flex h-7 min-w-0 shrink-0 items-center gap-1 px-1 text-xs leading-4 whitespace-nowrap",
        word && "after:min-w-0 after:truncate after:content-[attr(data-word)]",
        tone,
        className,
      )}
    >
      {icon}
    </span>
  );
}

// Who else has the project open, as one mark and a count, where the dots of PresentPeople have no room. It names them
// all, for the pointer and for a screen reader, the way the dots' group does.
export function PeopleCount({ className }: { className?: string }) {
  const peers = usePresence((s) => s.peers);
  if (peers.length === 0) return null;
  const names = `${MESSAGES.alsoHere}: ${peers.map((p) => p.name).join(", ")}`;
  return (
    <span
      role="img"
      aria-label={names}
      title={names}
      data-people-count
      className={cx("flex h-6 shrink-0 items-center gap-1 rounded-full border border-ed-line px-1.5 text-[11px] leading-4 font-medium text-ed-text tabular-nums", className)}
    >
      <Users aria-hidden className="size-3 shrink-0 stroke-2 text-ed-muted" />
      {peers.length}
    </span>
  );
}
