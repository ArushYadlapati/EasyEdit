import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PEER_LOOKS, peerLook } from "@/components/editor/peer-look";
import { REQUEST_TIMEOUT_MS } from "@/lib/editor/api";
import {
  PEER_COLOURS,
  PEER_POLL_MAX_MS,
  PRESENCE_LIST_MAX_AGE_MS,
  assignColours,
  clipMarks,
  createPresenceStore,
  earliestStart,
  initials,
  newTabId,
  outgoingShare,
  peerSummary,
  readPeers,
  sameSelection,
  shortName,
  trackMarks,
  type Peer,
  type PeerWire,
} from "@/lib/editor/presence";
import { POLL_DELAYS_MS } from "@/lib/editor/sync";
import { LIMITS } from "@/lib/limits";
import { sampleDoc } from "./fixtures";

// u1 to u5 hash to five different slots (0, 4, 3, 2, 1); u6 and u7 collide with u1 and u2.
const wire = (userId: string, name: string, clipIds: string[] = [], trackId: string | null = null): PeerWire => ({ userId, name, clipIds, trackId });
const peer = (userId: string, name: string, clipIds: string[] = [], trackId: string | null = null): Peer => ({
  ...wire(userId, name, clipIds, trackId),
  short: name.split(" ")[0],
  initials: initials(name),
  colour: 0,
});

describe("readPeers", () => {
  it("drops malformed entries and me, and caps clip ids", () => {
    const many = Array.from({ length: 150 }, (_, i) => `c${i}`);
    const raw: unknown[] = [
      null,
      "u2",
      { userId: 2, name: "Grace", clipIds: [], trackId: null },
      { userId: "u2", name: null, clipIds: [], trackId: null },
      { userId: "u2", name: "Grace", clipIds: "c1", trackId: null },
      { userId: "u2", name: "Grace", clipIds: ["c1", 7], trackId: null },
      { userId: "u2", name: "Grace", clipIds: [], trackId: 3 },
      { userId: "u2", name: "Grace", clipIds: [] },
      { userId: "u1", name: "Ada", clipIds: ["c1"], trackId: null },
      { userId: "u3", name: "Lin", clipIds: ["c1"], trackId: null, extra: true },
      { userId: "u4", name: "  ", clipIds: many, trackId: "t1" },
    ];
    const read = readPeers(raw, "u1");
    expect(read).toEqual([
      { userId: "u3", name: "Lin", clipIds: ["c1"], trackId: null },
      { userId: "u4", name: "Someone", clipIds: many.slice(0, LIMITS.presenceClipIds), trackId: "t1" },
    ]);
  });
});

describe("the presence store", () => {
  it("lists teammates sorted by name, with short names, initials and colours, and gives you a colour too", () => {
    const store = createPresenceStore("u1");
    store.getState().receive([wire("u3", "Lin Chen", ["c1"]), wire("u2", "Grace Hopper", [], "t1")], 500);
    const s = store.getState();
    expect(s.peers.map((p) => [p.userId, p.short, p.initials, p.colour])).toEqual([
      ["u2", "Grace", "GH", 4],
      ["u3", "Lin", "LC", 3],
    ]);
    expect(s.meColour).toBe(0);
    expect(s.heardAt).toBe(500);
  });

  it("receive keeps the same array when nothing changed, and always sets heardAt", () => {
    const store = createPresenceStore("u1");
    store.getState().receive([wire("u2", "Grace", ["c1", "c2"])], 100);
    const first = store.getState().peers;
    store.getState().receive([wire("u2", "Grace", ["c1", "c2"])], 200);
    expect(store.getState().peers).toBe(first);
    expect(store.getState().heardAt).toBe(200);

    store.getState().receive([wire("u2", "Grace", ["c1"])], 300);
    expect(store.getState().peers).not.toBe(first);
    expect(store.getState().peers[0].clipIds).toEqual(["c1"]);
  });

  it("never lists you, and lists one person once", () => {
    const store = createPresenceStore("u1");
    store.getState().receive([wire("u1", "Ada"), wire("u2", "Grace", ["c1"]), wire("u2", "Grace", ["c2"])], 100);
    expect(store.getState().peers.map((p) => [p.userId, p.clipIds])).toEqual([["u2", ["c1"]]]);
  });

  it("an empty list and forget() both use the same empty array; forget also clears heardAt and your colour", () => {
    const store = createPresenceStore("u1");
    const empty = store.getState().peers;
    store.getState().receive([], 100);
    expect(store.getState()).toMatchObject({ peers: empty, heardAt: 100, meColour: null });

    store.getState().receive([wire("u2", "Grace")], 200);
    store.getState().forget();
    expect(store.getState()).toMatchObject({ peers: empty, heardAt: null, meColour: null });

    let notified = 0;
    store.subscribe(() => (notified += 1));
    store.getState().forget();
    expect(notified).toBe(0);
  });
});

describe("assignColours", () => {
  it("gives the same slots for the same set, in any order", () => {
    const a = assignColours(["u3", "u1", "u2"]);
    const b = assignColours(["u2", "u3", "u1", "u2"]);
    expect([...a].sort()).toEqual([...b].sort());
    expect(a.get("u1")).toBe(0);
  });

  it("gives distinct colours to up to five people, even when their hashes collide", () => {
    const colours = assignColours(["u1", "u2", "u3", "u6", "u7"]);
    expect(new Set(colours.values()).size).toBe(5);
    expect(Object.fromEntries(colours)).toEqual({ u1: 0, u2: 4, u3: 3, u6: 1, u7: 2 });
  });

  it("a non-colliding person keeps their slot when someone joins", () => {
    const before = assignColours(["u1", "u2"]);
    const after = assignColours(["u1", "u2", "u3"]);
    expect(after.get("u1")).toBe(before.get("u1"));
    expect(after.get("u2")).toBe(before.get("u2"));
  });

  it("with more people than slots, colours repeat by hash", () => {
    const colours = assignColours(["u1", "u2", "u3", "u4", "u5", "u6"]);
    expect(colours.get("u6")).toBe(colours.get("u1"));
    expect(Math.max(...colours.values())).toBeLessThan(PEER_COLOURS);
  });
});

describe("names", () => {
  it("a short name is the first word, or the full name when another person present shares it", () => {
    expect(shortName("Grace Hopper", ["Lin Chen"])).toBe("Grace");
    expect(shortName("Grace Hopper", ["grace Kelly", "Lin Chen"])).toBe("Grace Hopper");
    expect(shortName("Cher", [])).toBe("Cher");
    expect(shortName("  Ada   Lovelace ", [])).toBe("Ada");
  });

  it("two people listed with the same first word both get their full names", () => {
    const store = createPresenceStore("u1");
    store.getState().receive([wire("u2", "Grace Hopper"), wire("u3", "Grace Kelly"), wire("u4", "Lin")], 100);
    expect(store.getState().peers.map((p) => p.short)).toEqual(["Grace Hopper", "Grace Kelly", "Lin"]);
  });

  it("initials are the first letters of two words, upper-cased and whole code points", () => {
    expect(initials("grace hopper")).toBe("GH");
    expect(initials("Ada Byron Lovelace")).toBe("AB");
    expect(initials("Lin")).toBe("L");
    expect(initials("😀 émile")).toBe("😀É");
    expect(initials("𝒜da Byron")).toBe("𝒜B");
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});

describe("outgoingShare and sameSelection", () => {
  it("caps, dedupes, sorts and drops ids that cannot be shown", () => {
    const long = "x".repeat(LIMITS.presenceIdChars + 1);
    expect(outgoingShare({ clipIds: ["c2", "c1", "c2", "", long], trackId: null })).toEqual({ clipIds: ["c1", "c2"], trackId: null });
    expect(outgoingShare({ clipIds: [], trackId: long })).toEqual({ clipIds: [], trackId: null });
    expect(outgoingShare({ clipIds: [], trackId: "t1" })).toEqual({ clipIds: [], trackId: "t1" });
    const many = Array.from({ length: 150 }, (_, i) => `c${String(i).padStart(3, "0")}`).reverse();
    const shared = outgoingShare({ clipIds: many, trackId: null }).clipIds;
    expect(shared).toHaveLength(LIMITS.presenceClipIds);
    expect(shared[0]).toBe("c000");
    expect(shared.at(-1)).toBe("c099");
  });

  it("sameSelection compares contents, not order or identity", () => {
    expect(sameSelection({ clipIds: ["a", "b"], trackId: null }, { clipIds: ["b", "a"], trackId: null })).toBe(true);
    expect(sameSelection({ clipIds: ["a"], trackId: null }, { clipIds: ["a", "b"], trackId: null })).toBe(false);
    expect(sameSelection({ clipIds: [], trackId: "t1" }, { clipIds: [], trackId: "t2" })).toBe(false);
    expect(sameSelection({ clipIds: [], trackId: null }, { clipIds: [], trackId: null })).toBe(true);
  });

  it("a tab id is 12 url-safe characters, new each time", () => {
    const a = newTabId();
    expect(a).toMatch(/^[\w-]{12}$/);
    expect(newTabId()).not.toBe(a);
  });
});

describe("marks and summaries", () => {
  const grace = peer("u2", "Grace Hopper", ["c1", "x1"]);
  const lin = peer("u3", "Lin Chen", ["c1"], null);
  const cy = peer("u4", "Cy", [], "t1");

  it("clipMarks maps each clip to the people on it, in list order", () => {
    const marks = clipMarks([grace, lin, cy]);
    expect([...marks.keys()].sort()).toEqual(["c1", "x1"]);
    expect(marks.get("c1")).toEqual([grace, lin]);
    expect(marks.get("x1")).toEqual([grace]);
  });

  it("trackMarks maps each track to the people on it", () => {
    const other = peer("u5", "Bo", [], "t1");
    const marks = trackMarks([grace, cy, other]);
    expect([...marks.keys()]).toEqual(["t1"]);
    expect(marks.get("t1")).toEqual([cy, other]);
  });

  it("peerSummary counts only clips that exist here, then names the track", () => {
    const doc = sampleDoc();
    const textTrack = doc.tracks[1];
    expect(peerSummary(grace, doc)).toBe("2 clips selected");
    expect(peerSummary(peer("u2", "G", ["c2", "gone"]), doc)).toBe("1 clip selected");
    expect(peerSummary(peer("u2", "G", [], textTrack.id), doc)).toBe(`${textTrack.name} track selected`);
    expect(peerSummary(peer("u2", "G", ["gone"], "gone"), doc)).toBe("nothing selected");
    expect(peerSummary(peer("u2", "G"), doc)).toBe("nothing selected");
  });

  it("earliestStart is the earliest start of their clips here, or null", () => {
    const doc = sampleDoc();
    expect(earliestStart(peer("u2", "G", ["x2", "c2", "gone"]), doc)).toBe(30);
    expect(earliestStart(peer("u2", "G", ["gone"]), doc)).toBeNull();
    expect(earliestStart(peer("u2", "G", [], "t1"), doc)).toBeNull();
  });
});

describe("the look of each colour", () => {
  it("has one look per slot, written out in full, and a token for each in the editor's styles", () => {
    expect(PEER_LOOKS).toHaveLength(PEER_COLOURS);
    const css = readFileSync("src/app/globals.css", "utf8");
    PEER_LOOKS.forEach((look, i) => {
      const n = i + 1;
      expect(look).toEqual({ stroke: `stroke-ed-peer-${n}`, bg: `bg-ed-peer-${n}`, border: `border-ed-peer-${n}`, text: `text-ed-peer-${n}` });
      expect(css).toContain(`--color-ed-peer-${n}: var(--ed-peer-${n});`);
      expect(css).toMatch(new RegExp(`--ed-peer-${n}: #[0-9a-f]{6};`));
    });
    expect(peerLook(PEER_COLOURS)).toBe(PEER_LOOKS[0]);
    expect(peerLook(-1)).toBe(PEER_LOOKS[PEER_COLOURS - 1]);
  });
});

// The longest time between two writes of one tab's row while it keeps checking on this schedule: the server writes an
// unchanged row again at the first check at least LIMITS.presenceRefreshMs after its last write.
function longestWriteGap(startIndex: number, cap: number | null): number {
  let at = 0;
  let lastWrite = 0;
  let longest = 0;
  for (let k = 0; k < 200; k++) {
    const delay = POLL_DELAYS_MS[Math.min(startIndex + k, POLL_DELAYS_MS.length - 1)];
    at += cap === null ? delay : Math.min(delay, cap);
    if (at - lastWrite >= LIMITS.presenceRefreshMs) {
      longest = Math.max(longest, at - lastWrite);
      lastWrite = at;
    }
  }
  return longest;
}

describe("presence limits", () => {
  it("a tab that is still checking never blinks out, on any part of the schedule, with or without a teammate here", () => {
    for (const cap of [null, PEER_POLL_MAX_MS]) {
      for (let start = 0; start < POLL_DELAYS_MS.length; start++) {
        expect(longestWriteGap(start, cap) + REQUEST_TIMEOUT_MS, `start ${start}, cap ${cap}`).toBeLessThan(LIMITS.presenceTtlMs);
      }
    }
    expect(longestWriteGap(POLL_DELAYS_MS.length - 1, null)).toBe(Math.max(...POLL_DELAYS_MS));
  });

  it("during a backlog of edits, one send and then the share still land inside the TTL", () => {
    expect(LIMITS.presenceRefreshMs + 2 * REQUEST_TIMEOUT_MS).toBeLessThan(LIMITS.presenceTtlMs);
  });

  it("a list is kept longer than the slowest check plus its timeout, and the cap is below the slowest check", () => {
    expect(Math.max(...POLL_DELAYS_MS) + REQUEST_TIMEOUT_MS).toBeLessThan(PRESENCE_LIST_MAX_AGE_MS);
    expect(PEER_POLL_MAX_MS).toBeLessThan(Math.max(...POLL_DELAYS_MS));
  });
});
