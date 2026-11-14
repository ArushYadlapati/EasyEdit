import { LIMITS } from "@/lib/limits";
import type { ApiFailure, ApiResult, PresenceApi, ProjectApi } from "./api";
import { MESSAGES } from "./messages";
import {
  PEER_POLL_MAX_MS, PRESENCE_LIST_MAX_AGE_MS, PRESENCE_RETRY_MS, newTabId, outgoingShare, readPeers, sameSelection,
  type PresenceStore,
} from "./presence";
import type { EditorStore } from "./store";
import type { ActivityEntry, SyncStatus } from "./types";

export const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000]; // the last one repeats
export const PULL_PAGE = LIMITS.opsPageMax;

// Indexed by the number of polls since the last activity; the last one repeats.
export const POLL_DELAYS_MS = [2000, 2000, 2000, 2000, 2000, 4000, 8000, 16000, 30000];

// No version checks once this long has passed without activity, so a tab left open and untouched
// does not keep the database awake. The next activity checks at once.
export const POLL_IDLE_LIMIT_MS = 10 * 60_000;

// The third 409 in a row for one edit refuses it.
const MAX_CONFLICTS = 3;

export function nextPollDelay(quietPolls: number): number {
  return POLL_DELAYS_MS[Math.min(Math.max(0, quietPolls), POLL_DELAYS_MS.length - 1)];
}

export type Sync = {
  start(): void; // safe to call again after stop()
  stop(): void; // clears every timer and the store subscription
  stopWhenSent(): void; // stops polling, sends what is queued, then stops; at once when nothing can be sent
  noteActivity(): void; // the user did something: poll again within 2 s, or at once after an idle spell
  visibilityChanged(): void; // call on the document's visibilitychange event
  retryNow(): void; // call on the window's online event
  leave(): void; // call when the page goes away (pagehide); stopWhenSent() calls it too
};

// Teammates' selections ride on the check for changes: each check shares this tab's selection and reads theirs.
// `makeTabId` defaults to newTabId.
export type SyncPresence = { api: PresenceApi; store: PresenceStore; makeTabId?: () => string };

type Step = () => Promise<unknown>;

// Why nothing more is requested. Signed out lasts until the tab is shown again or a retry is asked
// for (the person may have signed in again elsewhere); deleted lasts for good.
type Halt = "signed-out" | "deleted";

const NETWORK_FAILURE: ApiFailure = { ok: false, kind: "network" };

// Keeps the store's server copy in step with the project's op log: sends queued edits one at a
// time, polls for other people's edits, catches up, and retries after network failures.
export function createSync(deps: { store: EditorStore; api: ProjectApi; isVisible: () => boolean; presence?: SyncPresence }): Sync {
  const { store, api, isVisible, presence } = deps;
  const state = () => store.getState();

  let running = false;
  let busy = false; // a request is in flight; requests never overlap
  let halted: Halt | null = null;
  let closing = false; // stopWhenSent() was called: send the queue, poll no more, then stop
  let failures = 0; // failed tries in a row; above 0 the status is offline (or still signed out, while trying again)
  let retryDue = false; // the wait after the last failure is over
  let quietPolls = 0;
  let lastActivityAt = 0;
  let idle = false; // polling stopped for lack of activity
  let pollAt: number | null = null; // when the next poll is due
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let conflicts = { editId: "", count: 0 };

  // Used only with presence. Times are on this browser's clock and only compared with each other.
  let tabId = presence ? (presence.makeTabId?.() ?? newTabId()) : "";
  let generation = 0; // bumped on leave(), so a share answered after it changes nothing
  let startedAt = 0;
  let lastShareAt: number | null = null; // when a share last worked
  let selectionChangedAt = Date.now();
  let shareFailures = 0; // shares refused in a row while the plain check worked
  let shareRetryAt = 0; // no share before this, after a refusal

  // Teammates' list, or null without presence.
  const teammates = () => presence?.store.getState() ?? null;

  // Drops a list nobody has refreshed for a while, so a stale mark never lingers.
  function forgetIfStale() {
    const list = teammates();
    if (list && list.heardAt !== null && Date.now() - list.heardAt > PRESENCE_LIST_MAX_AGE_MS) list.forget();
  }

  // While someone else is here a quiet tab still checks every PEER_POLL_MAX_MS, so their changes show soon.
  function pollDelay(): number {
    const delay = nextPollDelay(quietPolls);
    return (teammates()?.peers.length ?? 0) > 0 ? Math.min(delay, PEER_POLL_MAX_MS) : delay;
  }

  function clearTimers() {
    if (pollTimer !== null) clearTimeout(pollTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    pollTimer = retryTimer = null;
  }

  function armPoll(at: number) {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
    idle = at - lastActivityAt > POLL_IDLE_LIMIT_MS;
    if (idle) teammates()?.forget(); // no more checks, so nothing would keep the list current
    pollAt = idle ? null : at;
    if (pollAt !== null && running && !halted && !closing && isVisible()) pollTimer = setTimeout(pump, Math.max(0, at - Date.now()));
  }

  // A local edit, a remote change found, or the user doing something. After an idle spell it
  // checks at once.
  function activity() {
    lastActivityAt = Date.now();
    quietPolls = 0;
    const soon = idle ? lastActivityAt : lastActivityAt + nextPollDelay(0);
    if (pollAt === null || pollAt > soon) armPoll(soon);
  }

  // This tab's selection changed: check within 2 s so teammates see it, without counting as the person's activity.
  // A selection trimmed by someone else's edit must not keep an untouched tab checking past its idle stop.
  function sendSoon() {
    const soon = Date.now() + nextPollDelay(0);
    if (!idle && (pollAt === null || pollAt > soon)) armPoll(soon);
  }

  // Saving while edits wait and the last request worked; saved once they are all in.
  function refreshStatus() {
    if (halted || failures > 0) return;
    const next: SyncStatus = state().queue.length > 0 ? "saving" : "saved";
    if (state().status !== next) state().setStatus(next);
  }

  // A whole step worked. Ends an offline spell; polling resumes on its usual schedule.
  function reached() {
    if (failures === 0) return;
    failures = 0;
    retryDue = false;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    armPoll(Date.now() + pollDelay());
    refreshStatus();
  }

  function halt(status: Halt) {
    halted = status;
    clearTimers();
    teammates()?.forget();
    state().setStatus(status);
  }

  // After a sign-out, tries again as at the end of an offline spell: a catch-up first when edits
  // wait, else a version check. The status stays "Signed out" until a request works; a 401 halts
  // again.
  function resume() {
    halted = null;
    failures = Math.max(failures, 1);
    retryDue = true;
    void pump();
  }

  // Handles a failure that ends the current step. `sendingId` is the edit being sent, if any.
  function failed(failure: ApiFailure, sendingId?: string) {
    switch (failure.kind) {
      case "signed-out": {
        // Told once: a 401 while trying again finds the status already "Signed out".
        const first = state().status !== "signed-out";
        halt("signed-out");
        if (first) state().notify("error", MESSAGES.signedOut);
        return;
      }
      case "not-found":
        halt("deleted");
        return;
      case "forbidden":
        reached();
        if (state().canEdit) state().revokeEditing();
        return;
      default: {
        // A network failure, or an answer that makes no sense for this request: wait and try again.
        if (sendingId) state().markSent(sendingId, true);
        failures += 1;
        retryDue = false;
        state().setStatus("offline");
        forgetIfStale(); // each retry looks again
        if (retryTimer !== null) clearTimeout(retryTimer);
        const delay = RETRY_DELAYS_MS[Math.min(failures - 1, RETRY_DELAYS_MS.length - 1)];
        retryTimer = setTimeout(() => {
          retryTimer = null;
          retryDue = true;
          pump();
        }, delay);
      }
    }
  }

  // Reads every log entry after the server copy and applies them, or reloads the whole project
  // when they no longer fit. A head still marked sent afterwards did not land. Returns true when
  // it finished; only then does an offline spell end, so a range that keeps failing half way still
  // backs off.
  async function catchUp(): Promise<boolean> {
    const entries: ActivityEntry[] = [];
    let since = state().server.version;
    for (;;) {
      const page = await api.getOpsSince(since, PULL_PAGE);
      if (!running) return false;
      if (!page.ok) {
        failed(page);
        return false;
      }
      entries.push(...page.entries);
      // A page can be cut short by size, so only hasMore says whether the range is complete.
      if (!page.hasMore || page.version <= since) break;
      since = page.version;
    }
    const me = state().me.id;
    if (entries.some((e) => e.version > state().server.version && e.actor !== me)) activity();
    if (!state().applyRemote(entries)) {
      const project = await api.getProject();
      if (!running) return false;
      if (!project.ok) {
        failed(project);
        return false;
      }
      state().replaceServer(project.doc, project.version);
    }
    reached();
    const head = state().queue[0];
    if (head?.sent) state().markSent(head.id, false);
    return true;
  }

  // Only runs while online, so there is no offline spell to end here.
  async function send() {
    const head = state().queue[0];
    const answer = await api.postOps({ baseVersion: state().server.version, ops: head.ops, requestId: head.id });
    if (!running) return;
    if (!answer.ok && answer.kind === "conflict") {
      conflicts = { editId: head.id, count: conflicts.editId === head.id ? conflicts.count + 1 : 1 };
      if (conflicts.count >= MAX_CONFLICTS) state().refuse(head.id, "INVALID");
      return catchUp();
    }
    conflicts = { editId: "", count: 0 };
    if (!answer.ok && answer.kind === "op") {
      state().refuse(head.id, answer.code);
      return catchUp();
    }
    if (!answer.ok) return failed(answer, head.id);
    if (answer.version > state().server.version + 1) {
      // Other edits landed first. The catch-up finds this one in the log and confirms it.
      state().markSent(head.id, true);
      return catchUp();
    }
    // The next version, or a replayed answer for an edit the server copy already holds.
    state().ack(head.id, answer.version, answer.inverse);
  }

  // The check for changes. With presence it shares this tab's selection and reads the teammates' list on the way;
  // null when the sync stopped meanwhile.
  async function check(): Promise<ApiResult<{ version: number }> | null> {
    if (!presence || Date.now() < shareRetryAt) return api.getVersion();
    const gen = generation;
    const answer = await presence.api.share({
      tabId,
      ...outgoingShare(state().selection),
      changedAgoMs: Math.min(Date.now() - selectionChangedAt, LIMITS.presenceKeepMs),
    });
    if (!running) return null;
    const list = presence.store.getState();
    if (answer.ok) {
      if (gen === generation) {
        lastShareAt = Date.now();
        shareFailures = 0;
        if (answer.peers) list.receive(readPeers(answer.peers, state().me.id), Date.now());
        else forgetIfStale();
      }
      return answer;
    }
    if (answer.kind !== "share-refused") return answer; // network, signed-out, not-found: failed() as today
    // The server answered, and the answer says the share itself is broken (a rollback, a misfiring cross-site check).
    // A 403 here must not revoke editing, so the plain check decides, in the same step.
    const plain = await api.getVersion();
    if (!running) return null;
    if (plain.ok) {
      shareFailures += 1;
      shareRetryAt = Date.now() + PRESENCE_RETRY_MS[Math.min(shareFailures - 1, PRESENCE_RETRY_MS.length - 1)];
      list.forget();
    }
    return plain;
  }

  async function poll() {
    const answer = await check();
    if (!running || !answer) return;
    if (!answer.ok) {
      failed(answer);
      if (answer.kind !== "forbidden") return;
    }
    quietPolls += 1;
    armPoll(Date.now() + pollDelay());
    if (answer.ok && answer.version > state().server.version) {
      activity();
      await catchUp();
    } else if (answer.ok) {
      reached();
    }
  }

  function nextStep(): Step | null {
    if (!running || halted) return null;
    const hasHead = state().queue.length > 0;
    // Closing: only sends, and only while every request works.
    if (closing) return hasHead && failures === 0 ? send : null;
    if (failures > 0) {
      // While offline nothing is requested until the wait is over. The failed send may have
      // reached the server, so a catch-up comes before it is sent again.
      if (!retryDue) return null;
      if (hasHead) return catchUp;
      // A hidden tab makes no version checks; showing it again does the retry.
      return isVisible() ? poll : null;
    }
    if (hasHead) return shareOverdue() ? poll : send;
    if (pollAt !== null && Date.now() >= pollAt && isVisible()) return poll;
    return null;
  }

  // A long backlog of edits must not keep this tab from sharing until teammates stop seeing it: one check goes out
  // between sends once the last share is LIMITS.presenceRefreshMs old.
  function shareOverdue(): boolean {
    if (!presence || !isVisible() || Date.now() < shareRetryAt) return false;
    return Date.now() - (lastShareAt ?? startedAt) >= LIMITS.presenceRefreshMs;
  }

  // Runs steps one after another until nothing is due. Never runs two at once. A step that throws
  // is reported and then handled like a network failure, so the loop keeps going with its back-off.
  async function pump() {
    if (busy) return;
    busy = true;
    try {
      for (let step = nextStep(); step; step = nextStep()) {
        retryDue = false;
        try {
          await step();
        } catch (error) {
          console.error(error);
          if (running && !halted) failed(NETWORK_FAILURE);
        }
      }
    } finally {
      busy = false;
    }
    if (closing && cannotSendMore()) stop();
  }

  // Nothing is left to send, or nothing can be sent before the person comes back.
  function cannotSendMore(): boolean {
    return state().queue.length === 0 || halted !== null || failures > 0;
  }

  function stop() {
    running = false;
    closing = false;
    clearTimers();
    pollAt = null;
    unsubscribe?.();
    unsubscribe = null;
    teammates()?.forget();
  }

  // The editor is closing or the page is going away: tells the server once that this tab is gone, so teammates stop
  // seeing it at once. Sends nothing when teammates could no longer see this tab anyway, so closing an idle or
  // long-hidden tab never wakes the database. A page kept for Back shares again under a new tab id.
  function leave() {
    if (!presence) return;
    generation += 1;
    presence.store.getState().forget();
    const visible = lastShareAt !== null && Date.now() - lastShareAt < LIMITS.presenceTtlMs;
    const old = tabId;
    tabId = presence.makeTabId?.() ?? newTabId();
    lastShareAt = null;
    if (visible) presence.api.leave(old);
  }

  return {
    start() {
      if (running) {
        // Mounted again before the queue was sent: carry on as before.
        if (closing) {
          closing = false;
          armPoll(Date.now() + pollDelay());
        }
        return;
      }
      running = true;
      startedAt = Date.now();
      unsubscribe = store.subscribe((next, prev) => {
        if (presence && next.selection !== prev.selection && !sameSelection(next.selection, prev.selection)) {
          selectionChangedAt = Date.now();
          sendSoon();
        }
        if (next.queue === prev.queue) return;
        const last = next.queue.at(-1);
        if (last && !prev.queue.some((e) => e.id === last.id)) activity();
        refreshStatus();
        void pump();
      });
      quietPolls = 0;
      lastActivityAt = Date.now();
      if (failures > 0) retryDue = true;
      armPoll(Date.now() + pollDelay());
      refreshStatus();
      void pump();
    },

    stop,

    stopWhenSent() {
      leave();
      if (!running) return;
      if (cannotSendMore()) {
        stop();
        return;
      }
      closing = true;
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
      pollAt = null;
      void pump();
    },

    noteActivity() {
      if (running) activity();
    },

    visibilityChanged() {
      if (!running) return;
      if (!isVisible()) {
        if (pollTimer !== null) clearTimeout(pollTimer);
        pollTimer = null;
        return;
      }
      lastActivityAt = Date.now(); // the tab shown again counts as activity
      forgetIfStale(); // a laptop waking up: the old list goes before the check that refills it
      if (halted === "signed-out") resume();
      else armPoll(Date.now());
    },

    retryNow() {
      if (!running) return;
      if (halted === "signed-out") {
        resume();
        return;
      }
      if (halted || failures === 0) return;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      retryDue = true;
      void pump();
    },

    leave,
  };
}
