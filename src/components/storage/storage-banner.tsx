import Link from "next/link";
import type { ReactNode } from "react";
import { linkButtonClass } from "@/components/ui/button-class";
import { cx } from "@/components/ui/cx";
import { STORAGE_MESSAGES, type Note, type StorageCard } from "@/lib/storage/messages";

// A space whose Google connection broke, at the top of its dashboard: uploads wait for an admin, and admins get
// Reconnect, which opens storage settings. The page shows it to every member, since they all upload.
// Reconnect is for the admin who connected the account (isOwner); another admin is told who can.
export function StorageBanner({ settingsHref, isAdmin, isOwner, ownerEmail }: { settingsHref: string; isAdmin: boolean; isOwner: boolean; ownerEmail: string | null }): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-ed-warn/50 bg-ed-warn/10 px-3 py-2">
      <p className="min-w-0 flex-1 text-[13px] leading-5 text-ed-text">{STORAGE_MESSAGES.banner}</p>
      {isAdmin && isOwner && (
        <Link href={settingsHref} className={linkButtonClass("primary")}>
          {STORAGE_MESSAGES.reconnect}
        </Link>
      )}
      {isAdmin && !isOwner && <p className="text-[13px] leading-5 text-ed-muted">{STORAGE_MESSAGES.onlyOwner(ownerEmail)}</p>}
    </div>
  );
}

// The setup card at the top of a dashboard whose space has no storage, for the people who can set it up.
export function StorageSetupCard({ card, settingsHref }: { card: StorageCard; settingsHref: string }): ReactNode {
  return (
    <section aria-label={card.title} className="flex flex-col items-start gap-2 rounded-md border border-ed-line bg-ed-panel p-4">
      <h2 className="text-sm font-semibold">{card.title}</h2>
      <p className="text-[13px] leading-5 text-ed-muted">{card.text}</p>
      {card.note && <p className="text-[13px] leading-5 text-ed-muted">{card.note}</p>}
      {card.action && (
        <Link href={settingsHref} className={linkButtonClass("primary", "mt-1")}>
          {card.action === "choose" ? STORAGE_MESSAGES.chooseAccount : STORAGE_MESSAGES.reconnect}
        </Link>
      )}
    </section>
  );
}

// What came back from connecting a Google account (?storage=…): a problem is an alert, the rest a status line.
export function StorageNote({ note }: { note: Note }): ReactNode {
  return (
    <p role={note.problem ? "alert" : "status"} className={cx("text-[13px] leading-5", note.problem ? "text-ed-danger" : "text-ed-text")}>
      {note.text}
    </p>
  );
}
