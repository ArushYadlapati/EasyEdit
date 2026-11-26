import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSavedTranscript, saveTranscriptToServer } from "@/lib/captions/transcript-client";

afterEach(() => vi.unstubAllGlobals());

const WORDS = [{ t: "hola", s: 0, e: 300 }];
const answering = (body: unknown, ok = true) => {
  const fetched = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>>(async () => ({ ok, json: async () => body }));
  vi.stubGlobal("fetch", fetched);
  return fetched;
};

describe("the words saved for a file", () => {
  it("are given when there are some, whatever they are marked with, to a caller that names no mark", async () => {
    const fetched = answering({ transcript: { words: WORDS, model: "m#spanish" } });
    expect(await fetchSavedTranscript("a b")).toEqual(WORDS);
    expect(fetched).toHaveBeenCalledWith("/api/media/a%20b/transcript", { cache: "no-store" });
  });
  it("are given only when marked as asked for: words heard as Spanish are not handed out as English", async () => {
    answering({ transcript: { words: WORDS, model: "m#spanish" } });
    expect(await fetchSavedTranscript("a", "m#spanish")).toEqual(WORDS);
    expect(await fetchSavedTranscript("a", "m")).toBeNull();
    expect(await fetchSavedTranscript("a", "m#spanish>english")).toBeNull();
  });
  it("are none when the server has none, answers badly, or cannot be reached", async () => {
    answering({ transcript: null });
    expect(await fetchSavedTranscript("a", "m")).toBeNull();
    answering({ transcript: { words: "no" } });
    expect(await fetchSavedTranscript("a")).toBeNull();
    answering({}, false);
    expect(await fetchSavedTranscript("a")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchSavedTranscript("a")).toBeNull();
  });
  it("are saved with their mark", async () => {
    const fetched = answering({});
    expect(await saveTranscriptToServer("a", WORDS, "m#spanish")).toBe(true);
    expect(fetched).toHaveBeenCalledWith("/api/media/a/transcript", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ words: WORDS, model: "m#spanish" }) });
  });
});
