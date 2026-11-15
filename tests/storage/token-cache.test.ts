import { afterEach, describe, expect, it } from "vitest";
import type { AccessSource } from "@/lib/drive/token";
import { forgetAllSources, forgetSources, keptSource, keptSourceCount } from "@/lib/storage/token-cache";

const source = (): AccessSource => ({ token: async () => ({ accessToken: "t", expiresAt: 0 }) });

afterEach(() => forgetAllSources());

describe("the kept token sources", () => {
  it("hands back the same source for the same key and the same makings, and a new one otherwise", () => {
    const fetchA = (() => {}) as unknown as typeof fetch;
    const fetchB = (() => {}) as unknown as typeof fetch;
    const first = keptSource("connection:c1:h1", [fetchA], source);
    expect(keptSource("connection:c1:h1", [fetchA], source)).toBe(first);
    const other = keptSource("connection:c1:h1", [fetchB], source); // made with another fetch: not the same source
    expect(other).not.toBe(first);
    expect(keptSource("connection:c1:h1", [fetchB], source)).toBe(other);
    expect(keptSourceCount()).toBe(1);
  });

  it("keeps at most 200, dropping the one used longest ago", () => {
    const by = [fetch];
    const oldest = keptSource("k0", by, source);
    const used = keptSource("k1", by, source);
    for (let i = 2; i < 200; i += 1) keptSource(`k${i}`, by, source);
    expect(keptSource("k1", by, source)).toBe(used); // used again: now the most recent
    keptSource("k200", by, source);
    expect(keptSourceCount()).toBe(200);
    expect(keptSource("k1", by, source)).toBe(used);
    expect(keptSource("k0", by, source)).not.toBe(oldest); // it was dropped, and is made again
  });

  it("forgets the sources of one connection but the one it is told to keep", () => {
    const by = [fetch];
    keptSource("connection:c1:old", by, source);
    const current = keptSource("connection:c1:new", by, source);
    const other = keptSource("connection:c2:x", by, source);
    forgetSources("connection:c1:", "connection:c1:new");
    expect(keptSourceCount()).toBe(2);
    expect(keptSource("connection:c1:new", by, source)).toBe(current);
    expect(keptSource("connection:c2:x", by, source)).toBe(other);
  });
});
