"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/text-input";
import type { ReviewApi } from "@/lib/review/client";
import { REVIEW_LIMITS, REVIEW_MESSAGES, type VersionView } from "@/lib/review/rules";
import { timeAgo } from "@/lib/time-ago";
import { useEditor } from "../context";
import { LINK } from "./comments-list";
import type { Review } from "./review-context";

type Load = "loading" | "ready" | "failed";

// The project's named versions, newest first, under a box that saves one. A version is the timeline as the server
// has it, so saving waits for changes still on their way. Opening one makes a new project beside this one: nothing
// here is put back, so nothing made since is lost.
export function VersionsList({ review }: { review: Review }) {
  const canEdit = useEditor((s) => s.canEdit);
  const unsent = useEditor((s) => s.queue.length > 0);
  const [versions, setVersions] = useState<VersionView[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ id: string; name: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null); // the version whose Delete was pressed once
  const [now] = useState(() => new Date());
  const { api } = review;

  // The list as the server has it, onto the screen. A failed ask keeps what is shown.
  const show = useCallback((answer: Awaited<ReturnType<ReviewApi["versions"]>>) => {
    if (!answer.ok) return setLoad((before) => (before === "ready" ? "ready" : "failed"));
    setVersions(answer.versions);
    setLoad("ready");
  }, []);
  const refresh = useCallback(() => api.versions().then(show), [api, show]);
  useEffect(() => {
    let live = true;
    void api.versions().then((answer) => live && show(answer));
    return () => {
      live = false;
    };
  }, [api, show]);

  // Runs one call, shows what went wrong, and lists the versions again.
  async function run(work: Promise<{ ok: true } | { ok: false; message: string }>): Promise<boolean> {
    setBusy(true);
    const answer = await work;
    setBusy(false);
    setProblem(answer.ok ? null : answer.message);
    await refresh();
    return answer.ok;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await run(api.saveVersion(name))) setName("");
  }
  async function open(version: VersionView) {
    setBusy(true);
    const answer = await api.openVersion(version.id);
    setBusy(false);
    setProblem(answer.ok ? null : answer.message);
    if (answer.ok) setOpened({ id: answer.id, name: version.name });
    else await refresh();
  }

  const full = versions.length >= REVIEW_LIMITS.versionsPerProject;
  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <form className="flex flex-col gap-1.5" onSubmit={save}>
          <div className="flex items-center gap-2">
            <TextInput aria-label="Name for this version" className="min-w-0 flex-1" placeholder="Rough cut" maxLength={REVIEW_LIMITS.versionNameChars} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
            <Button type="submit" variant="primary" disabled={busy || unsent || full || !name.trim()}>
              Save version
            </Button>
          </div>
          <p className="text-[13px] leading-5 text-ed-muted">{full ? REVIEW_MESSAGES.versionsFull : unsent ? "Saving your changes first…" : "Keeps the timeline as it is now, to go back to later."}</p>
        </form>
      )}
      {problem && <p role="alert" className="text-xs text-ed-danger">{problem}</p>}
      {opened && (
        <p role="status" className="text-[13px] leading-5 text-ed-text">
          “{opened.name}” is now a project of its own.{" "}
          <a className="underline underline-offset-2" href={review.projectHref(opened.id)} target="_blank" rel="noopener">
            Open it
          </a>
        </p>
      )}
      {load === "loading" ? (
        <p className="text-[13px] leading-5 text-ed-muted">Loading…</p>
      ) : load === "failed" ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-[13px] leading-5 text-ed-muted">Couldn&apos;t load the versions.</p>
          <Button onClick={() => void refresh()}>Try again</Button>
        </div>
      ) : versions.length === 0 ? (
        <p className="text-[13px] leading-5 text-ed-muted">No versions yet.</p>
      ) : (
        <ul role="list" className="flex flex-col gap-2">
          {versions.map((version) => (
            <li key={version.id} className="flex flex-col gap-1 rounded-md border border-ed-line p-2">
              {renaming?.id === version.id ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (await run(api.renameVersion(version.id, renaming.name))) setRenaming(null);
                  }}
                >
                  <TextInput aria-label={`New name for ${version.name}`} className="min-w-0 flex-1" maxLength={REVIEW_LIMITS.versionNameChars} value={renaming.name} onChange={(event) => setRenaming({ id: version.id, name: event.target.value })} onKeyDown={(event) => event.stopPropagation()} />
                  <Button type="submit" disabled={busy || !renaming.name.trim()}>
                    Save
                  </Button>
                  <Button type="button" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <p className="text-[13px] leading-5 font-medium wrap-break-word text-ed-text">{version.name}</p>
              )}
              <p className="text-[11px] leading-4 text-ed-muted">
                {version.by} · {timeAgo(new Date(version.createdAt), now, "short")}
              </p>
              {version.stale && <p className="text-xs text-ed-warn">{REVIEW_MESSAGES.versionStale}</p>}
              {canEdit && renaming?.id !== version.id && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {!version.stale && (
                    <button type="button" className={LINK} disabled={busy} aria-label={`Open ${version.name} as a new project`} onClick={() => void open(version)}>
                      Open as a new project
                    </button>
                  )}
                  <button type="button" className={LINK} aria-label={`Rename ${version.name}`} onClick={() => setRenaming({ id: version.id, name: version.name })}>
                    Rename
                  </button>
                  {deleting === version.id ? (
                    <button type="button" className={LINK} disabled={busy} aria-label={`Yes, delete ${version.name}`} onClick={() => void run(api.deleteVersion(version.id)).then(() => setDeleting(null))}>
                      Delete for good?
                    </button>
                  ) : (
                    <button type="button" className={LINK} aria-label={`Delete ${version.name}`} onClick={() => setDeleting(version.id)}>
                      Delete
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
