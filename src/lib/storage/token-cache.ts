import "server-only";
import type { AccessSource } from "@/lib/drive/token";

// The token sources this server process keeps between requests, so a media request doesn't ask Google for a new token
// each time: a person's connection, by its id and its sealed refresh token (a reconnect seals a new one, so it is
// a different entry), and a team's reader, by its address. At most MAX_KEPT; the one used longest ago goes first.
// A source keeps its own token and asks again when too little of it is left.

const MAX_KEPT = 200;

// `by`: what the source was made with that a key doesn't name (the fetch it speaks through, the caller that speaks for
// a reader). A source made with other ones is not handed out for the key.
type Kept = { by: readonly unknown[]; source: AccessSource };

const kept = new Map<string, Kept>();

const sameBy = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((value, i) => value === b[i]);

export function keptSource(key: string, by: readonly unknown[], make: () => AccessSource): AccessSource {
  const found = kept.get(key);
  kept.delete(key);
  const entry = found && sameBy(found.by, by) ? found : { by, source: make() };
  kept.set(key, entry); // last in the map: used most recently
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value!);
  return entry.source;
}

// Drops every kept source whose key starts with `prefix`, except `keep`.
export function forgetSources(prefix: string, keep?: string): void {
  for (const key of [...kept.keys()]) if (key.startsWith(prefix) && key !== keep) kept.delete(key);
}

// Drops them all: Google refused a token one of them gave, and which one isn't known.
export function forgetAllSources(): void {
  kept.clear();
}

export const keptSourceCount = () => kept.size;
