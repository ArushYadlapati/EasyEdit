"use client";

import { useRouter } from "next/navigation";
import { useId, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { StorageNote } from "@/components/storage/storage-banner";
import { Button, linkButtonClass } from "@/components/ui/button";
import {
  SETUP_CARD,
  STORAGE_MESSAGES,
  connectHref,
  settingsNote,
  storageSettingsPath,
  usageLine,
} from "@/lib/storage/messages";
import type { StorageSettingsView } from "@/lib/storage/settings-view";
import type { StorageFormState } from "@/lib/storage/storage-actions";

export type StorageSettingsProps = {
  view: StorageSettingsView;
  note: string | null; // ?storage=… as the address has it; only the known ones say anything
  first: boolean; // just after creating the team (?first=1)
  choose(formData: FormData): Promise<StorageFormState>; // "Use <email>", with the space bound
};

const TEXT = "text-[13px] leading-5 text-ed-text";
const MUTED = "text-[13px] leading-5 text-ed-muted";
const ROW = "flex flex-wrap items-center gap-2";
// A long address shortens on a narrow window rather than pushing the page sideways.
const FITS = "max-w-full";
const LABEL = "min-w-0 truncate";

// Starting a connect is a full page load (the route sends the browser on to Google), so these are plain links.
function ConnectLink({ href, primary, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return (
    <a href={href} className={linkButtonClass(primary ? "primary" : "default", FITS)}>
      <span className={LABEL}>{children}</span>
    </a>
  );
}

// The storage tab of a space's settings, for its admins: where its videos are stored, and the ways to change that
// this server can carry out. Nothing here sends anyone to Google when the server couldn't finish the connect.
export function StorageSettings({ view, note, first, choose }: StorageSettingsProps): ReactNode {
  const router = useRouter();
  const chosen = useAction(choose);
  const headingId = useId();
  const { space, storage, connections, blocked } = view;
  const shown = settingsNote(note);
  const blockedText = blocked === "server" ? STORAGE_MESSAGES.serverNotSetUp : blocked === "team" ? STORAGE_MESSAGES.teamNotSetUp : null;

  function pick(connectionId: string) {
    const formData = new FormData();
    formData.set("connectionId", connectionId);
    chosen.submit(formData, { onSuccess: () => router.replace(`${storageSettingsPath(space.slug)}?storage=connected`) });
  }

  function current(): ReactNode {
    if (storage.kind === "shared_folder") return <p className={TEXT}>{STORAGE_MESSAGES.sharedFolder}</p>;

    if (storage.kind === "google_account") {
      // Reconnecting the same account keeps the storage as it is, so it works even where new team storage can't be made.
      const canReconnect = blocked !== "server";
      const moveRefused = storage.hasUploads ? STORAGE_MESSAGES.moveLater : blocked === "team" ? STORAGE_MESSAGES.teamNotSetUp : null;
      return (
        <>
          <div className="flex flex-col gap-1">
            <p className={`${TEXT} break-words`}>{STORAGE_MESSAGES.storedIn(storage.email)}</p>
            {storage.folderName && <p className={MUTED}>{STORAGE_MESSAGES.folder(storage.folderName)}</p>}
            {storage.usage && <p className={MUTED}>{usageLine(storage.usage)}</p>}
          </div>
          {storage.broken && (
            <p role="alert" className="text-[13px] leading-5 text-ed-danger">
              {STORAGE_MESSAGES.brokenHere}
            </p>
          )}
          {canReconnect ? (
            <div className="flex flex-col gap-2">
              <div className={ROW}>
                <ConnectLink href={connectHref(space.id, storage.email)} primary={storage.broken}>
                  {STORAGE_MESSAGES.reconnect}
                </ConnectLink>
                {moveRefused === null ? (
                  <ConnectLink href={connectHref(space.id)}>{STORAGE_MESSAGES.useDifferent}</ConnectLink>
                ) : (
                  <Button disabled>{STORAGE_MESSAGES.useDifferent}</Button>
                )}
              </div>
              {moveRefused !== null && <p className={MUTED}>{moveRefused}</p>}
            </div>
          ) : (
            <p className={MUTED}>{blockedText}</p>
          )}
        </>
      );
    }

    // No storage yet.
    const intro = space.kind === "personal" ? SETUP_CARD.personalText : first ? null : STORAGE_MESSAGES.noneTeam;
    return (
      <>
        {intro !== null && <p className={TEXT}>{intro}</p>}
        {blockedText !== null ? (
          <p className={MUTED}>{blockedText}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {connections.length === 0 ? (
              <div className={ROW}>
                <ConnectLink href={connectHref(space.id)} primary>
                  {STORAGE_MESSAGES.connect}
                </ConnectLink>
              </div>
            ) : (
              <>
                <ul aria-label="Your Google accounts" className="flex flex-col items-start gap-2">
                  {connections.map((connection) => (
                    <li key={connection.id} className={FITS}>
                      {/* Google ended this one: choosing it goes back through Google's screen, for that account. */}
                      {connection.broken ? (
                        <ConnectLink href={connectHref(space.id, connection.email)} primary>
                          {STORAGE_MESSAGES.accountChoice(connection.email)}
                        </ConnectLink>
                      ) : (
                        <Button variant="primary" className={FITS} disabled={chosen.pending} onClick={() => pick(connection.id)}>
                          <span className={LABEL}>{STORAGE_MESSAGES.accountChoice(connection.email)}</span>
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className={ROW}>
                  <ConnectLink href={connectHref(space.id)}>{STORAGE_MESSAGES.useDifferent}</ConnectLink>
                </div>
              </>
            )}
            <p className={MUTED}>{STORAGE_MESSAGES.ownFolder}</p>
            {chosen.error !== null && (
              <p role="alert" className="text-[13px] leading-5 text-ed-danger">
                {chosen.error}
              </p>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="sr-only">
        Storage
      </h2>
      {shown && <StorageNote note={shown} />}
      {first && storage.kind === "none" && space.kind === "team" && (
        <p className="text-sm font-semibold text-ed-text">{STORAGE_MESSAGES.firstRun}</p>
      )}
      {current()}
    </section>
  );
}
