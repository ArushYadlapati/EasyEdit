"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { ACTIVITY_LIMIT, findClip } from "@/lib/editor/store";
import { MADE_BEFORE_MOVE, activityRows, hasOlderActivity, loadOlderActivity, loadRecentActivity } from "@/lib/editor/activity";
import { actorLook, agentLook, type ActorLook } from "./actor-look";
import { useEditor, useEditorApi, useEditorStore } from "./context";
import { useLibrary } from "./media/media-context";
import { usePresence } from "./presence-context";

type Load = "loading" | "failed" | "ready";

const NOW_REFRESH_MS = 30_000;
const SUMMARY = "text-[13px] leading-5 wrap-break-word";

export function ActivityPanel() {
  const store = useEditorStore();
  const api = useEditorApi();
  const activity = useEditor((s) => s.activity);
  const me = useEditor((s) => s.me);
  const doc = useEditor((s) => s.server.doc);
  const canEdit = useEditor((s) => s.canEdit);
  const movedAtVersion = useEditor((s) => s.movedAtVersion);
  const serverVersion = useEditor((s) => s.server.version);
  const undoChange = useEditor((s) => s.undoChange);
  const assets = useLibrary((s) => s.assets);
  const peers = usePresence((s) => s.peers);

  const [load, setLoad] = useState<Load>("loading");
  const [attempt, setAttempt] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const loadNext = useRef(true); // load on the next run of the effect: set on mount and by "Try again"
  const inFlight = useRef<number | null>(null); // the server version a running load was started for
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Loads when the panel first shows and after "Try again". Later it reloads only when the project
  // moved on and the newest loaded change is behind it, once per version change.
  useEffect(() => {
    const forced = loadNext.current;
    loadNext.current = false;
    const { activity: loaded, server } = store.getState();
    const behind = (loaded.at(-1)?.version ?? 0) < server.version;
    if (!forced && !behind) return;
    if (inFlight.current === server.version) return;
    inFlight.current = server.version;
    void loadRecentActivity(api, store).then((ok) => {
      inFlight.current = null;
      if (mounted.current) setLoad(ok ? "ready" : "failed");
    });
  }, [api, store, serverVersion, attempt]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), NOW_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  function showEarlier() {
    setLoadingOlder(true);
    void loadOlderActivity(api, store).then((ok) => {
      if (!mounted.current) return;
      setLoadingOlder(false);
      setOlderFailed(!ok);
    });
  }

  const rows = useMemo(
    () => activityRows(activity, me.id, now, { doc, movedAtVersion, assetName: (id) => assets[id]?.name }),
    [activity, me.id, now, doc, movedAtVersion, assets],
  );
  const byVersion = useMemo(() => new Map(activity.map((entry) => [entry.version, entry])), [activity]);

  if (rows.length === 0) {
    if (load === "loading") return <Message>Loading…</Message>;
    if (load === "failed") {
      return (
        <Message>
          <span>Couldn&apos;t load changes.</span>
          <Button
            onClick={() => {
              loadNext.current = true;
              setLoad("loading");
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </Message>
      );
    }
    return <Message>No changes yet.</Message>;
  }

  const older = hasOlderActivity(activity);

  // Selects the clips a change touched, as they are now, and puts the playhead at the first of them.
  function showChange(clipIds: string[]) {
    const state = store.getState();
    const found = clipIds.map((id) => findClip(state.doc, id)).filter((f) => f !== null);
    if (found.length === 0) return;
    state.select(found.map((f) => f.clip.id));
    state.seek(Math.min(...found.map((f) => f.clip.start)));
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ul role="list" className="flex flex-col">
        {rows.map((row) => {
          const entry = byVersion.get(row.version);
          const who = entry ? <Who name={row.who} look={actorLook(entry.actor, me.id, peers)} agent={agentLook(entry.actor) !== null} /> : row.who;
          return (
            <li key={row.version} className="flex flex-col gap-1 border-b border-ed-line px-3 py-2">
              {/* The whole summary, wrapping as it needs: the list is there to say what changed. A change to clips still
                  in the project selects them and moves the playhead to the first, so the row shows what it did. */}
              {row.clipIds.length > 0 ? (
                <button
                  type="button"
                  title="Select what this changed"
                  onClick={() => showChange(row.clipIds)}
                  className={cx(SUMMARY, "-mx-1 rounded-[4px] px-1 text-left hover:bg-ed-raised", row.undone ? "text-ed-muted" : "text-ed-text", FOCUS_RING, FADE)}
                >
                  {who} · {row.summary}
                </button>
              ) : (
                <p className={cx(SUMMARY, row.undone ? "text-ed-muted" : "text-ed-text")}>
                  {who} · {row.summary}
                </p>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] leading-4 text-ed-muted">{row.when}</p>
                {row.beforeMove ? (
                  <p className="text-[11px] leading-4 text-ed-muted">{MADE_BEFORE_MOVE}</p>
                ) : row.undone ? (
                  <p className="text-[11px] leading-4 text-ed-muted">Undone</p>
                ) : (
                  row.canUndo &&
                  canEdit &&
                  entry && (
                    <Button data-edit-control variant="ghost" size="sm" onClick={() => undoChange(entry)}>
                      Undo this change
                    </Button>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col items-start gap-2 p-3">
        {olderFailed && (
          <>
            <p className="text-[13px] leading-5 text-ed-muted">Couldn&apos;t load changes.</p>
            <Button disabled={loadingOlder} onClick={showEarlier}>
              Try again
            </Button>
          </>
        )}
        {older && !olderFailed && (
          <Button disabled={loadingOlder} onClick={showEarlier}>
            Show earlier changes
          </Button>
        )}
        {!older && activity.length >= ACTIVITY_LIMIT && (
          <p className="text-[13px] leading-5 text-ed-muted">Showing the latest {ACTIVITY_LIMIT} changes.</p>
        )}
      </div>
    </div>
  );
}

// Who made a change, after a dot in their colour (you in blue, a teammate in theirs while they are here, an AI agent in
// its own); an agent's name is in its colour too, so its work reads as its own down the list.
function Who({ name, look, agent }: { name: string; look: ActorLook | null; agent: boolean }) {
  return (
    <>
      {look && <span aria-hidden className={cx("mr-1.5 mb-px inline-block size-2 rounded-full align-middle", look.bg)} />}
      <span className={cx(agent && look && cx(look.text, "font-medium"))}>{name}</span>
    </>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-[13px] leading-5 text-ed-muted">{children}</div>;
}
