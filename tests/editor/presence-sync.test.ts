import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGES } from "@/lib/editor/messages";
import { PEER_POLL_MAX_MS, PRESENCE_LIST_MAX_AGE_MS, createPresenceStore, type PeerWire } from "@/lib/editor/presence";
import { POLL_IDLE_LIMIT_MS, createSync } from "@/lib/editor/sync";
import { LIMITS } from "@/lib/limits";
import type { OpInput } from "@/lib/timeline";
import { makeFakePresence } from "./fake-presence";
import { makeFakeServer } from "./fake-server";
import { makeStore, sampleDoc } from "./fixtures";

const GRACE: PeerWire = { userId: "u2", name: "Grace Hopper", clipIds: ["x1"], trackId: null };
const move = (start: number): OpInput[] => [{ op: "move_clip", clipId: "x2", start }];
const retext = (value: string): OpInput[] => [{ op: "update_clip", clipId: "x1", patch: { text: value } }];
const settle = () => vi.advanceTimersByTimeAsync(0);
const after = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const gaps = (times: number[]) => times.slice(1).map((t, i) => t - times[i]);

// Ada (u1) in a sync that shares her selection. Each tab id is tab-1, tab-2 and so on.
function setup() {
  const server = makeFakeServer(sampleDoc(), 5);
  const fake = makeFakePresence(server);
  const store = makeStore();
  const presence = createPresenceStore("u1");
  let visible = true;
  let tabs = 0;
  const sync = createSync({
    store, api: server.api, isVisible: () => visible,
    presence: { api: fake.api, store: presence, makeTabId: () => `tab-${++tabs}` },
  });
  sync.start();
  const show = (v: boolean) => { visible = v; sync.visibilityChanged(); };
  return { server, fake, sync, show, store, st: () => store.getState(), list: () => presence.getState() };
}

beforeEach(() => { vi.useFakeTimers({ now: 0 }); }); // times below read from the start
afterEach(() => { vi.useRealTimers(); });

describe("sharing", () => {
  it("a check shares this tab's selection instead of checking the version", async () => {
    const { server, fake, st, list } = setup();
    fake.answer([GRACE]);
    server.remote(retext("GO"));
    st().select(["x2", "x1", "x2"]);
    await after(2000);
    expect(fake.presenceCalls).toEqual(["share"]);
    expect(fake.shares[0]).toMatchObject({ tabId: "tab-1", clipIds: ["x1", "x2"], trackId: null, changedAgoMs: 2000 });
    expect(server.calls).toEqual(["ops"]); // no GET /version; the share's version found the remote edit
    expect(st().server.version).toBe(6);
    expect(list().peers).toMatchObject([{ userId: "u2", name: "Grace Hopper", short: "Grace", initials: "GH", clipIds: ["x1"] }]);
    st().selectTrack("t1");
    await after(2000);
    expect(fake.shares[1]).toMatchObject({ clipIds: [], trackId: "t1", changedAgoMs: 2000 });
  });

  it("a new selection goes out within 2 s and does not delay the idle stop", async () => {
    const { fake, st } = setup();
    await after(100_000); // quiet: checks are 30 s apart by now
    const before = fake.count();
    st().select(["x1"]);
    await after(1999);
    expect(fake.count()).toBe(before);
    await after(1);
    expect(fake.count()).toBe(before + 1);
    expect(fake.shares.at(-1)).toMatchObject({ clipIds: ["x1"], changedAgoMs: 2000 });

    await after(450_000);
    st().select(["x2"]); // at 552 s
    await after(2000);
    expect(fake.shares.at(-1)).toMatchObject({ clipIds: ["x2"] });
    await after(60 * 60_000);
    expect(fake.sharedAt().every((t) => t <= POLL_IDLE_LIMIT_MS)).toBe(true);
    const idle = fake.count();
    st().select(["x1"]); // after the idle stop: nothing goes out until the person does something
    await after(60_000);
    expect(fake.count()).toBe(idle);
  });

  it("a selection trimmed by someone else's edit does not count as activity", async () => {
    const { fake, store, st } = setup();
    st().select(["x1", "x2"]);
    await after(300_000);
    // What the store does when a teammate's edit removes x2: the selection keeps what still exists.
    const before = fake.count();
    store.setState({ selection: { clipIds: ["x1"], trackId: null } });
    await after(2000);
    expect(fake.count()).toBe(before + 1);
    expect(fake.shares.at(-1)!.clipIds).toEqual(["x1"]);
    // The back-off goes on as it was: the next check is 30 s later, not 2 s.
    await after(29_999);
    expect(fake.count()).toBe(before + 1);
    await after(1);
    expect(fake.count()).toBe(before + 2);
    await after(60 * 60_000);
    expect(fake.sharedAt().every((t) => t <= POLL_IDLE_LIMIT_MS)).toBe(true);
  });

  it("does not share a click on what is already selected", async () => {
    const { fake, st } = setup();
    st().select(["x1", "x2"]);
    await after(100_000);
    const before = fake.count();
    st().select(["x2", "x1"]); // a new object with the same contents
    await after(2000);
    expect(fake.count()).toBe(before);
  });
});

describe("cadence", () => {
  it("with someone here a quiet tab checks every 5 s; alone it backs off to 30 s", async () => {
    const { fake } = setup();
    fake.answer([GRACE]);
    await after(60_000);
    expect(gaps(fake.sharedAt()).slice(0, 8)).toEqual([2000, 2000, 2000, 2000, 4000, PEER_POLL_MAX_MS, PEER_POLL_MAX_MS, PEER_POLL_MAX_MS]);
    expect(new Set(gaps(fake.sharedAt()).slice(5))).toEqual(new Set([PEER_POLL_MAX_MS]));
    fake.answer([]); // Grace left
    const left = fake.count();
    await after(120_000);
    const later = fake.sharedAt().slice(left - 1);
    expect(gaps(later)).toEqual([PEER_POLL_MAX_MS, 30_000, 30_000, 30_000]); // the first check alone lifts the cap
  });

  it("a watcher whose teammate changes selection on every check makes at most 123 checks in 10 quiet minutes, then stops, and the list clears", async () => {
    const { server, fake, list } = setup();
    fake.answer((n) => [{ ...GRACE, clipIds: [n % 2 ? "x1" : "x2"] }]);
    await after(20 * 60_000);
    expect(fake.count()).toBeLessThanOrEqual(123);
    expect(fake.count()).toBeGreaterThan(100);
    expect(fake.sharedAt().every((t) => t <= POLL_IDLE_LIMIT_MS)).toBe(true);
    expect(list()).toMatchObject({ peers: [], heardAt: null, meColour: null });
    expect(server.calls).toEqual([]);
  });

  it("the same list again changes nothing and keeps the same array", async () => {
    const { fake, list } = setup();
    fake.answer([GRACE]);
    await after(2000);
    const peers = list().peers;
    expect(list().heardAt).toBe(2000);
    await after(2000);
    expect(list().peers).toBe(peers);
    expect(list().heardAt).toBe(4000);
  });

  it("answers without peers clear the list once it is 60 s old, and the cap lifts", async () => {
    const { fake, list } = setup();
    fake.answer([GRACE]);
    await after(2000);
    fake.answer(null); // the server's breaker is open
    await after(PRESENCE_LIST_MAX_AGE_MS); // the check at 59 s finds the list 57 s old
    expect(list().peers).toHaveLength(1);
    expect(list().heardAt).toBe(2000);
    await after(2000); // the check at 64 s finds it too old
    expect(list().peers).toEqual([]);
    const at = fake.count();
    await after(29_999);
    expect(fake.count()).toBe(at);
    await after(1);
    expect(fake.count()).toBe(at + 1);
  });
});

describe("failures", () => {
  it("a share timeout or 5xx makes exactly one request in that step, goes offline as today, and neither pauses sharing nor clears a fresh list", async () => {
    const { server, fake, st, list } = setup();
    fake.answer([GRACE]);
    await after(2000);
    fake.fail("network");
    await after(2000);
    expect(fake.count()).toBe(2);
    expect(server.calls).toEqual([]);
    expect(st().status).toBe("offline");
    expect(list().peers).toHaveLength(1);
    await after(2000); // the retry shares again
    expect(fake.count()).toBe(3);
    expect(server.calls).toEqual([]);
    expect(st().status).toBe("saved");
    expect(list().heardAt).toBe(6000);
  });

  it("a long outage clears the list once it is 60 s old, at a retry", async () => {
    const { fake, st, list } = setup();
    fake.answer([GRACE]);
    await after(2000);
    fake.fail("network", 100);
    await after(60_000); // failures at 4, 6, 10, 18, 34 s, then every 30 s
    expect(st().status).toBe("offline");
    expect(list().peers).toHaveLength(1);
    await after(4000); // the retry at 64 s
    expect(list().peers).toEqual([]);
  });

  it("a share refused (403, 405, 400, or a 404 page) falls back to GET /version in the same step: the status stays Saved, editing is not revoked, the list clears, and sharing waits 60, then 120, then 300 s; a working share resets it", async () => {
    const { server, fake, sync, st, list } = setup();
    fake.answer([GRACE]);
    await after(2000);
    expect(list().peers).toHaveLength(1);
    fake.fail("share-refused", 3);
    await after(2000);
    expect(fake.count()).toBe(2);
    expect(server.calls).toEqual(["version"]);
    expect(st()).toMatchObject({ status: "saved", canEdit: true, notice: null });
    expect(list().peers).toEqual([]);

    await after(296_000);
    sync.noteActivity(); // at 300 s, so the tab keeps checking past the idle stop
    await after(300_000);
    // Refused at 4 s, then at the first check 60 s, 120 s and 300 s after each refusal; the share at 488 s works.
    const refusals = fake.sharedAt().slice(1, 5);
    expect(gaps(refusals).map((g, i) => g >= [60_000, 120_000, 300_000][i] && g < [60_000, 120_000, 300_000][i] + 30_000)).toEqual([true, true, true]);
    expect(fake.count()).toBeGreaterThan(5); // sharing again after the one that worked
    expect(list().peers).toHaveLength(1);
    expect(st()).toMatchObject({ status: "saved", canEdit: true });

    // After the working share, the next refusal waits 60 s again.
    fake.fail("share-refused");
    const shared = fake.count();
    await after(30_000);
    expect(fake.count()).toBe(shared + 1);
    const refusedAt = fake.sharedAt().at(-1)!;
    await after(120_000);
    const next = fake.sharedAt().find((t) => t > refusedAt)!;
    expect(next - refusedAt).toBeGreaterThanOrEqual(60_000);
    expect(next - refusedAt).toBeLessThan(90_000); // the first check after 60 s, not 120 s
  });

  it("a refused share whose plain check fails goes offline as today", async () => {
    const { server, fake, st } = setup();
    fake.fail("share-refused");
    server.fail("network");
    await after(2000);
    expect(server.calls).toEqual(["version"]);
    expect(st().status).toBe("offline");
    await after(2000); // not paused: the retry shares
    expect(fake.count()).toBe(2);
    expect(st().status).toBe("saved");
  });

  it("a share answering 404 NOT_FOUND halts as deleted and clears the list; 401 UNAUTHENTICATED halts as signed out, and showing the tab again refills it", async () => {
    const gone = setup();
    gone.fake.answer([GRACE]);
    await after(2000);
    gone.fake.fail("not-found");
    await after(2000);
    expect(gone.st().status).toBe("deleted");
    expect(gone.list().peers).toEqual([]);
    gone.show(true);
    await after(60_000);
    expect(gone.fake.count()).toBe(2);
    gone.sync.stop();

    const out = setup();
    out.fake.answer([GRACE]);
    await after(2000);
    out.fake.fail("signed-out");
    await after(2000);
    expect(out.st()).toMatchObject({ status: "signed-out", notice: { text: MESSAGES.signedOut } });
    expect(out.list().peers).toEqual([]);
    await after(60_000);
    expect(out.fake.count()).toBe(2);
    out.show(true); // signed in again elsewhere, then back to this tab
    await settle();
    expect(out.fake.count()).toBe(3);
    expect(out.st().status).toBe("saved");
    expect(out.list().peers).toHaveLength(1);
  });

  it("a hidden tab shares nothing; shown with a list over 60 s old, it drops it and checks at once", async () => {
    const { fake, show, list } = setup();
    fake.answer([GRACE]);
    await after(2000);
    show(false);
    await after(120_000);
    expect(fake.count()).toBe(1);
    expect(list().peers).toHaveLength(1); // hiding sends and clears nothing
    fake.hold();
    show(true);
    expect(list().peers).toEqual([]); // dropped before the check answers
    await settle();
    expect(fake.count()).toBe(2);
    fake.release();
    await settle();
    expect(list().peers).toHaveLength(1);
  });

  it("a tab shown again within 60 s keeps its list", async () => {
    const { fake, show, list } = setup();
    fake.answer([GRACE]);
    await after(2000);
    const peers = list().peers;
    show(false);
    await after(30_000);
    fake.hold();
    show(true);
    expect(list().peers).toBe(peers);
    fake.release();
  });
});

describe("a backlog of edits", () => {
  it("queued edits are sent first, but a share goes out within presenceRefreshMs plus one send during a long backlog", async () => {
    const { server, fake, st } = setup();
    const SEND_MS = 1000;
    const postOps = server.api.postOps;
    const postedAt: number[] = [];
    server.api.postOps = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, SEND_MS));
      postedAt.push(Date.now());
      return postOps(input);
    };
    for (let i = 0; i < 60; i++) st().edit(move(100 + i), "move");
    await after(100_000);
    expect(st()).toMatchObject({ queue: [], status: "saved" });
    expect(server.log).toHaveLength(60);
    expect(server.log.map((e) => (e.ops[0] as { start: number }).start)).toEqual(Array.from({ length: 60 }, (_, i) => 100 + i));
    const backlogEnd = postedAt.at(-1)!;
    const during = fake.sharedAt().filter((t) => t < backlogEnd);
    expect(postedAt[0]).toBeLessThan(during[0]); // the queue goes first
    expect(during.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...gaps([0, ...during]))).toBeLessThanOrEqual(LIMITS.presenceRefreshMs + SEND_MS);
  });
});

describe("leaving", () => {
  it("leave sends one DELETE after a recent share, and makes a new tab id", async () => {
    const { fake, sync, list } = setup();
    fake.answer([GRACE]);
    await after(2000);
    sync.leave();
    expect(fake.left()).toEqual(["tab-1"]);
    expect(list().peers).toEqual([]);
    sync.leave(); // nothing shared under the new id yet
    expect(fake.left()).toEqual(["tab-1"]);
    await after(2000);
    expect(fake.shares.at(-1)!.tabId).toBe("tab-3");
    expect(list().peers).toHaveLength(1);
  });

  it("stopWhenSent leaves first; before any share it sends nothing", async () => {
    const fresh = setup();
    fresh.sync.stopWhenSent();
    expect(fresh.fake.left()).toEqual([]);

    const shared = setup();
    await after(2000);
    shared.sync.stopWhenSent();
    expect(shared.fake.left()).toEqual(["tab-1"]);
    await after(120_000);
    expect(shared.fake.count()).toBe(1);
  });

  it("a tab closed after its idle stop, or hidden longer than the TTL, sends no DELETE", async () => {
    const idle = setup();
    await after(60 * 60_000);
    idle.sync.stopWhenSent();
    expect(idle.fake.left()).toEqual([]);

    const hidden = setup();
    await after(2000);
    hidden.show(false);
    await after(LIMITS.presenceTtlMs);
    hidden.sync.leave();
    expect(hidden.fake.left()).toEqual([]);
  });

  it("a share answer arriving after leave changes nothing", async () => {
    const { fake, sync, list } = setup();
    await after(2000);
    fake.answer([GRACE]);
    fake.hold();
    await after(2000); // the second share is in flight
    sync.leave();
    expect(fake.left()).toEqual(["tab-1"]);
    fake.release();
    await settle();
    expect(list()).toMatchObject({ peers: [], heardAt: null });
    sync.leave(); // the late answer did not count as a share
    expect(fake.left()).toEqual(["tab-1"]);
  });

  it("stop and halt leave no timers", async () => {
    const stopped = setup();
    stopped.fake.answer([GRACE]);
    await after(10_000);
    stopped.sync.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(stopped.list().peers).toEqual([]);

    for (const kind of ["not-found", "signed-out"] as const) {
      const halted = setup();
      halted.fake.answer([GRACE]);
      await after(2000);
      halted.fake.fail(kind);
      await after(2000);
      expect(halted.st().status).toBe(kind === "not-found" ? "deleted" : "signed-out");
      expect(vi.getTimerCount()).toBe(0);
      expect(halted.list().peers).toEqual([]);
      halted.sync.stop();
    }
  });
});

describe("after the project moved to another space", () => {
  function setupIn(spaceId = "s1") {
    const server = makeFakeServer(sampleDoc(), 5);
    const fake = makeFakePresence(server);
    const store = makeStore();
    const presence = createPresenceStore("u1");
    const sync = createSync({
      store, api: server.api, isVisible: () => true, spaceId,
      presence: { api: fake.api, store: presence, makeTabId: () => "tab-1" },
    });
    sync.start();
    return { server, fake, sync, st: () => store.getState(), list: () => presence.getState() };
  }

  it("a share answering another space shows the move, applies none of its change, and checks no more", async () => {
    const { server, fake, st, list } = setupIn();
    fake.answer([GRACE]);
    await after(2000);
    expect(list().peers).toHaveLength(1);
    server.moveTo("s2", [{ op: "update_clip", clipId: "c1", patch: { assetId: "copy-a" } }]);
    await after(2000);
    expect(fake.count()).toBe(2);
    expect(server.calls).toEqual([]); // no catch-up
    expect(st()).toMatchObject({ moved: true, canEdit: false });
    expect(st().server.version).toBe(5);
    expect(list().peers).toEqual([]);
    await after(POLL_IDLE_LIMIT_MS);
    expect(fake.count()).toBe(2);
    expect(server.calls).toEqual([]);
  });

  it("a share answering 404 NOT_FOUND asks where the project is: moved when it is in another space", async () => {
    const { server, fake, st } = setupIn();
    server.moveTo("s2");
    fake.fail("not-found");
    await after(2000);
    expect(server.calls).toEqual(["version"]);
    expect(st().moved).toBe(true);
    expect(st().status).not.toBe("deleted");
  });
});
