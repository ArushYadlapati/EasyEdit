import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ANNOUNCE_QUIET_MS, burstMessage, watchEdits } from "@/lib/editor/announce";
import type { Op } from "@/lib/timeline";
import { makeFakeServer } from "./fake-server";
import { entry, makeStore, sampleDoc } from "./fixtures";

const move = (start: number): Op[] => [{ op: "move_clip", clipId: "x2", start }];
let stop: () => void = () => {};
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stop();
  vi.useRealTimers();
});

function watched(over: Parameters<typeof makeStore>[0] = {}) {
  const store = makeStore(over);
  const said: string[] = [];
  stop = watchEdits(store, (m) => said.push(m));
  return { store, said };
}

it("says one sentence a burst, per person, in Activity's words", () => {
  expect(burstMessage([{ who: null, summary: "Moved text “hi”" }])).toBe("Moved text “hi”.");
  expect(burstMessage([{ who: null, summary: "Moved text “hi”" }, { who: null, summary: "Moved text “hi”" }])).toBe("Moved text “hi”, 2 times.");
  expect(burstMessage([
    { who: "Theo", summary: "Added text “hi”" },
    { who: null, summary: "Moved text “hi”" },
    { who: "Theo", summary: "Deleted a shape" },
  ])).toBe("Theo: 2 changes. The last: Deleted a shape. Moved text “hi”.");
  expect(burstMessage([])).toBe("");
});

it("tells my own change once the burst is over, and a run of nudges as one", () => {
  const { store, said } = watched();
  store.getState().edit(move(100), "move");
  vi.advanceTimersByTime(ANNOUNCE_QUIET_MS - 1);
  store.getState().edit(move(101), "move");
  vi.advanceTimersByTime(ANNOUNCE_QUIET_MS - 1);
  expect(said).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(said).toEqual(["Moved text “hi”, 2 times."]);
});

it("tells my undo as an undo", () => {
  const { store, said } = watched();
  store.getState().edit(move(100), "move");
  vi.advanceTimersByTime(ANNOUNCE_QUIET_MS);
  store.getState().undo();
  vi.advanceTimersByTime(ANNOUNCE_QUIET_MS);
  expect(said).toEqual(["Moved text “hi”.", "Undid: Moved text “hi”."]);
});

it("tells a teammate's and an agent's changes as they arrive, by name, and never a page of history loading", () => {
  const { store, said } = watched();
  store.getState().loadActivity([entry(3, move(80))]);
  vi.advanceTimersByTime(ANNOUNCE_QUIET_MS);
  expect(said).toEqual([]);

  store.getState().applyRemote([entry(6, move(200), "u2", "Theo Park"), entry(7, [{ op: "remove_clip", clipId: "c1" }], "claude:u1", "Claude (for Ada)")]);
  vi.advanceTimersByTime(ANNOUNCE_QUIET_MS);
  expect(said).toEqual(["Theo Park: Moved text “hi”. Claude: Deleted a video clip on Video 1."]);
});

it("my own change coming back from the server is not told twice", async () => {
  const server = makeFakeServer(sampleDoc(), 5);
  const { store, said } = watched();
  store.getState().edit(move(100), "move");
  const head = store.getState().queue[0];
  const answer = await server.api.postOps({ baseVersion: 5, ops: head.ops, requestId: head.id });
  if (answer.ok) store.getState().ack(head.id, answer.version, answer.inverse);
  vi.advanceTimersByTime(ANNOUNCE_QUIET_MS);
  expect(said).toEqual(["Moved text “hi”."]);
});
