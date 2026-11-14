import { nanoid } from "nanoid";
import { createStore, type StoreApi } from "zustand/vanilla";
import { LIMITS } from "@/lib/limits";
import type { TimelineDoc } from "@/lib/timeline";
import { MESSAGES, clipsSelected, trackSelected } from "./messages";
import type { Selection } from "./types";

// What the other people with this project open have selected, as the last check for changes answered it. Nothing
// here changes your own selection; the board, the timeline and the top bar only draw it.

// A list of teammates not refreshed for this long is dropped: the slowest check (30 s) plus its timeout (15 s), plus slack.
export const PRESENCE_LIST_MAX_AGE_MS = 60_000;
// After the share is refused while the plain check works, sharing waits this long before trying again; the last repeats.
export const PRESENCE_RETRY_MS = [60_000, 120_000, 300_000];
// While someone else has the project open, a quiet tab still checks this often.
export const PEER_POLL_MAX_MS = 5000;
// The colour slots, --ed-peer-1 to --ed-peer-5. A colour is a slot index from 0, so slot 0 is --ed-peer-1.
export const PEER_COLOURS = 5;

export type PeerWire = { userId: string; name: string; clipIds: string[]; trackId: string | null };
export type Peer = PeerWire & { short: string; initials: string; colour: number };
export type PresenceState = {
  meColour: number | null; // your own colour while anyone else is here, for the "You" dot
  peers: Peer[]; // sorted by name, then id; the same array while nothing changed
  heardAt: number | null; // when the last list arrived, on this browser's clock (only compared with itself)
  receive(list: PeerWire[], at: number): void; // always sets heardAt; keeps `peers` when nothing in it changed
  forget(): void; // empties the list and clears heardAt; the same empty array each time
};
export type PresenceStore = StoreApi<PresenceState>;

const NO_PEERS: Peer[] = Object.freeze([]) as unknown as Peer[];

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

// The server's list, read defensively: an entry of the wrong shape is skipped, never trusted. You are dropped again
// here in case the server ever lists you.
export function readPeers(raw: unknown[], meId: string): PeerWire[] {
  const out: PeerWire[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { userId, name, clipIds, trackId } = entry as Record<string, unknown>;
    if (typeof userId !== "string" || typeof name !== "string" || !isStringArray(clipIds)) continue;
    if (trackId !== null && typeof trackId !== "string") continue;
    if (userId === meId) continue;
    out.push({ userId, name: name.trim() || MESSAGES.someone, clipIds: clipIds.slice(0, LIMITS.presenceClipIds), trackId });
  }
  return out;
}

// 32-bit FNV-1a over UTF-16 code units: cheap, and the same on every screen.
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// A colour slot for everyone present, you included, worked out from the ids alone: every screen that sees the same
// people sees the same colours, and refilling the list after forget() needs no memory. In id order, each person takes
// their hash slot, or the next free one if it is taken. With more people than slots, colours repeat.
export function assignColours(ids: readonly string[], slots = PEER_COLOURS): Map<string, number> {
  const sorted = [...new Set(ids)].sort();
  const colours = new Map<string, number>();
  const taken = new Set<number>();
  for (const id of sorted) {
    let slot = fnv1a(id) % slots;
    if (sorted.length <= slots) {
      while (taken.has(slot)) slot = (slot + 1) % slots;
      taken.add(slot);
    }
    colours.set(id, slot);
  }
  return colours;
}

const words = (name: string) => name.trim().split(/\s+/).filter(Boolean);

// The name on a board pill: the first word, or the full name when another person present has the same first word.
export function shortName(name: string, others: readonly string[]): string {
  const first = words(name)[0];
  if (first === undefined) return name;
  const key = first.toLowerCase();
  return others.some((other) => words(other)[0]?.toLowerCase() === key) ? name : first;
}

// The first letters of the first two words, whole code points so an emoji or a surrogate pair is never cut.
export function initials(name: string): string {
  const letters = words(name)
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("");
  return letters || "?";
}

// This tab's selection as it goes to the server: each id once, sorted, ids that cannot be shown dropped, and at most
// LIMITS.presenceClipIds of them.
export function outgoingShare(selection: Selection): { clipIds: string[]; trackId: string | null } {
  const fits = (id: string) => id.length > 0 && id.length <= LIMITS.presenceIdChars;
  const clipIds = [...new Set(selection.clipIds)].filter(fits).sort().slice(0, LIMITS.presenceClipIds);
  return { clipIds, trackId: selection.trackId !== null && fits(selection.trackId) ? selection.trackId : null };
}

// Whether two selections hold the same clips and track. select() always builds a new object, so a reference check
// would share a click on what is already selected.
export function sameSelection(a: Selection, b: Selection): boolean {
  if (a.trackId !== b.trackId || a.clipIds.length !== b.clipIds.length) return false;
  const left = [...a.clipIds].sort();
  const right = [...b.clipIds].sort();
  return left.every((id, i) => id === right[i]);
}

// One id per open editor tab, made per mount and never stored, so a duplicated browser tab gets its own.
export function newTabId(): string {
  return nanoid(12);
}

function samePeer(a: Peer, b: Peer): boolean {
  return (
    a.userId === b.userId &&
    a.name === b.name &&
    a.trackId === b.trackId &&
    a.short === b.short &&
    a.initials === b.initials &&
    a.colour === b.colour &&
    a.clipIds.length === b.clipIds.length &&
    a.clipIds.every((id, i) => id === b.clipIds[i])
  );
}

const byNameThenId = (a: PeerWire, b: PeerWire) => a.name.localeCompare(b.name) || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);

export function createPresenceStore(meId: string): PresenceStore {
  return createStore<PresenceState>()((set, get) => ({
    meColour: null,
    peers: NO_PEERS,
    heardAt: null,
    receive(list, at) {
      const seen = new Set<string>();
      const wire = list.filter((p) => p.userId !== meId && !seen.has(p.userId) && seen.add(p.userId)).sort(byNameThenId);
      if (wire.length === 0) {
        set({ peers: NO_PEERS, meColour: null, heardAt: at });
        return;
      }
      const colours = assignColours([meId, ...wire.map((p) => p.userId)]);
      const next = wire.map((p) => ({
        ...p,
        short: shortName(p.name, wire.filter((o) => o !== p).map((o) => o.name)),
        initials: initials(p.name),
        colour: colours.get(p.userId)!,
      }));
      const prev = get().peers;
      const unchanged = prev.length === next.length && prev.every((p, i) => samePeer(p, next[i]));
      set({ peers: unchanged ? prev : next, meColour: colours.get(meId)!, heardAt: at });
    },
    forget() {
      const s = get();
      if (s.peers === NO_PEERS && s.heardAt === null && s.meColour === null) return;
      set({ peers: NO_PEERS, meColour: null, heardAt: null });
    },
  }));
}

// Each clip id a teammate selected, with the teammates on it in list order. Drawing uses at most the first two.
export function clipMarks(peers: readonly Peer[]): Map<string, Peer[]> {
  const marks = new Map<string, Peer[]>();
  for (const peer of peers) {
    for (const id of peer.clipIds) {
      const on = marks.get(id);
      if (on) {
        if (!on.includes(peer)) on.push(peer);
      } else marks.set(id, [peer]);
    }
  }
  return marks;
}

// Each track id a teammate selected, with the teammates on it in list order.
export function trackMarks(peers: readonly Peer[]): Map<string, Peer[]> {
  const marks = new Map<string, Peer[]>();
  for (const peer of peers) {
    if (peer.trackId === null) continue;
    const on = marks.get(peer.trackId);
    if (on) on.push(peer);
    else marks.set(peer.trackId, [peer]);
  }
  return marks;
}

// The teammate's clips that exist here too. One whose edit has not arrived yet, or that was deleted since, is skipped.
export function localClips(peer: Peer, doc: TimelineDoc) {
  const ids = new Set(peer.clipIds);
  return doc.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)));
}

// What a teammate has selected, counting only what exists here: "2 clips selected", "Text 1 track selected".
export function peerSummary(peer: Peer, doc: TimelineDoc): string {
  const clips = localClips(peer, doc).length;
  if (clips > 0) return clipsSelected(clips);
  const track = peer.trackId === null ? undefined : doc.tracks.find((t) => t.id === peer.trackId);
  return track ? trackSelected(track.name) : MESSAGES.nothingSelected;
}

// Where the playhead goes to show a teammate's selection: the earliest start of their clips that exist here.
export function earliestStart(peer: Peer, doc: TimelineDoc): number | null {
  const starts = localClips(peer, doc).map((c) => c.start);
  return starts.length > 0 ? Math.min(...starts) : null;
}
