import { activityRows, shortActorName, undoLinks } from "./activity";
import type { EditorState, EditorStore } from "./store";
import type { ActivityEntry, PendingEdit } from "./types";

// What the editor says to a screen reader after a change, in Activity's own words: your own changes as you make them,
// and a teammate's or an AI agent's as they arrive. It waits for this long without a change and then says the whole
// burst once, so a run of nudges or a teammate's busy minute is one sentence, not one per change.
export const ANNOUNCE_QUIET_MS = 800;

type Said = { who: string | null; summary: string }; // who: null for you

// Activity's line for each of these changes, as the list would show it now: named clips, "Undid: …", "Redid: …".
// context: more changes that come before them (my edits not yet saved), and the project before them.
function summaries(
  state: EditorState,
  entries: ActivityEntry[],
  context: { earlier?: ActivityEntry[]; before: EditorState; assetName?: (assetId: string) => string | undefined },
): string[] {
  const told = new Set(entries.map((e) => e.version));
  const all = [...state.activity.filter((e) => !told.has(e.version)), ...(context.earlier ?? []), ...entries].sort((a, b) => a.version - b.version);
  const rows = activityRows(all, state.me.id, new Date(), {
    doc: state.doc,
    earlierDoc: context.before.doc,
    movedAtVersion: state.movedAtVersion,
    assetName: context.assetName,
  });
  const byVersion = new Map(rows.map((r) => [r.version, r]));
  return entries.map((e) => byVersion.get(e.version)?.summary ?? "");
}

// My own edits as entries the list could hold, numbered after everything it holds, so an undo of one already in the
// list (or still waiting to be sent) reads as one.
function asEntries(state: EditorState, edits: PendingEdit[]): ActivityEntry[] {
  const top = Math.max(state.server.version, state.activity.at(-1)?.version ?? 0);
  return edits.map((edit, i) => ({
    version: top + 1 + i,
    ops: edit.ops,
    inverse: edit.inverse,
    actor: state.me.id,
    actorName: state.me.name,
    createdAt: new Date(0).toISOString(),
  }));
}

// One sentence per person, in the order they first changed something: "Moved text “Hi”.", "Theo Park: Added text
// “Hi”.", "Claude: 4 changes. The last: Moved text “Hi”.". The same change several times over says how many.
export function burstMessage(said: readonly Said[]): string {
  const people: (string | null)[] = [];
  for (const s of said) if (!people.includes(s.who)) people.push(s.who);
  return people
    .map((who) => {
      const theirs = said.filter((s) => s.who === who && s.summary !== "");
      if (theirs.length === 0) return "";
      const last = theirs[theirs.length - 1].summary;
      const line =
        theirs.length === 1 ? last
        : theirs.every((s) => s.summary === last) ? `${last}, ${theirs.length} times`
        : `${theirs.length} changes. The last: ${last}`;
      return `${who === null ? "" : `${who}: `}${line}.`;
    })
    .filter((line) => line !== "")
    .join(" ");
}

// "Theo Park undid your change: Moved text “Hi”. It's in Activity if you want it back."
export function undoneMineMessage(who: string, what: string, count = 1): string {
  const head = count === 1 ? `${who} undid your change: ${what}.` : `${who} undid ${count} of your changes. The last: ${what}.`;
  return `${head} Undo theirs in Activity to bring it back.`;
}

// Calls say with one message per burst of changes, and tells me with a notice when someone else undid a change of
// mine. Returns the stop function.
export function watchEdits(
  store: EditorStore,
  say: (message: string) => void,
  opts: { quietMs?: number; assetName?: (assetId: string) => string | undefined } = {},
): () => void {
  const quietMs = opts.quietMs ?? ANNOUNCE_QUIET_MS;
  let burst: Said[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const message = burstMessage(burst);
    burst = [];
    if (message !== "") say(message);
  };
  const add = (said: Said[]) => {
    if (said.length === 0) return;
    burst.push(...said);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, quietMs);
  };
  const unsubscribe = store.subscribe((state, before) => {
    // My own: each edit, undo or redo as it is made (a refused one is told by its own notice).
    if (state.queue !== before.queue) {
      const added = state.queue.filter((e) => !before.queue.some((b) => b.id === e.id));
      if (added.length > 0) {
        const waiting = before.queue.filter((e) => state.queue.some((s) => s.id === e.id));
        const numbered = asEntries(before, [...waiting, ...added]);
        const lines = summaries(state, numbered.slice(waiting.length), { earlier: numbered.slice(0, waiting.length), before, assetName: opts.assetName });
        add(lines.map((summary) => ({ who: null, summary })));
      }
    }
    // Someone else's, as they arrive: the entries the server copy moved on by that are not mine.
    if (state.remote !== before.remote && state.remote !== null && state.server.version > before.server.version) {
      const arrived = state.activity.filter((e) => e.version > before.server.version && e.version <= state.server.version && e.actor !== state.me.id);
      // One of them undid a change of mine: a notice says so, which a screen reader hears too, so it is not said twice.
      const { undid } = undoLinks(state.activity);
      const byVersion = new Map(state.activity.map((e) => [e.version, e]));
      const mine = arrived.filter((e) => byVersion.get(undid.get(e.version) ?? -1)?.actor === state.me.id);
      const told = arrived.filter((e) => !mine.includes(e));
      const lines = summaries(state, told, { before, assetName: opts.assetName });
      add(told.map((e, i) => ({ who: shortActorName(e.actorName), summary: lines[i] })));
      const last = mine.at(-1);
      if (last) {
        const target = byVersion.get(undid.get(last.version)!)!;
        const [what] = summaries(state, [target], { before, assetName: opts.assetName });
        state.notify("info", undoneMineMessage(shortActorName(last.actorName), what, mine.length));
      }
    }
  });
  return () => {
    if (timer !== null) clearTimeout(timer);
    unsubscribe();
  };
}
