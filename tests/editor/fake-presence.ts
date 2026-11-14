import type { PresenceApi, PresenceResult, PresenceShare } from "@/lib/editor/api";
import type { makeFakeServer } from "./fake-server";

type Failure = "network" | "signed-out" | "not-found" | "share-refused";
type Answer = unknown[] | null | ((share: number) => unknown[] | null); // a function gets the share's number, from 1

// An in-memory stand-in for POST and DELETE /presence, answering with the fake server's version. It keeps its own
// call list, so `server.calls` reads exactly as it does without presence.
export function makeFakePresence(server: ReturnType<typeof makeFakeServer>) {
  const presenceCalls: string[] = []; // "share" and "leave <tab id>"
  const shares: (PresenceShare & { at: number })[] = [];
  let answer: Answer = [];
  let failures: Failure[] = [];
  let held: (() => void)[] | null = null;

  const api: PresenceApi = {
    async share(input) {
      presenceCalls.push("share");
      shares.push({ ...structuredClone(input), at: Date.now() });
      const n = shares.length;
      if (held) await new Promise<void>((resolve) => held!.push(resolve));
      const kind = failures.shift();
      if (kind) return { ok: false, kind } as PresenceResult;
      const peers = typeof answer === "function" ? answer(n) : answer;
      return { ok: true, version: server.version(), peers: peers === null ? null : structuredClone(peers) };
    },
    leave(tabId) {
      presenceCalls.push(`leave ${tabId}`);
    },
  };

  return {
    api, presenceCalls, shares,
    sharedAt: () => shares.map((s) => s.at),
    count: () => presenceCalls.filter((c) => c === "share").length,
    left: () => presenceCalls.filter((c) => c.startsWith("leave ")).map((c) => c.slice("leave ".length)),
    answer(next: Answer) { answer = next; }, // what the following shares answer as peers; null leaves them out
    fail(kind: Failure, times = 1) { failures = failures.concat(Array<Failure>(times).fill(kind)); },
    hold() { held ??= []; }, // the following shares wait for release()
    release() {
      const waiting = held ?? [];
      held = null;
      waiting.forEach((resolve) => resolve());
    },
  };
}
