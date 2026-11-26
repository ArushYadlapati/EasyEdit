import { afterEach, describe, expect, it, vi } from "vitest";
import { unpackBytes } from "@/lib/color/cube";
import { addReference, failAnalysis, fetchReferences, fetchStyle, removeReference, saveAnalysis, saveStyle, sheetUrl } from "@/lib/style/client";
import { DEFAULT_STYLE, type StyleReference, type VideoAnalysis } from "@/lib/style/types";

afterEach(() => vi.unstubAllGlobals());

// Answers every request with this status and body, and keeps what was asked.
function answer(status: number, body: unknown) {
  const fetchFn = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchFn);
  const call = (n = 0) => {
    const [input, init] = fetchFn.mock.calls[n];
    return { url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
  };
  return { fetchFn, call };
}

const REFERENCE: StyleReference = { id: "r1", kind: "video", title: "Match day", status: "pending", assetId: "a1", analysis: null, hasSheet: false, createdAt: "2026-11-25T10:00:00.000Z" };
const MEASURED = { kind: "video", seconds: 12.5 } as VideoAnalysis;

describe("the style client", () => {
  it("reads a style, and refuses an answer that isn't one", async () => {
    const { call } = answer(200, DEFAULT_STYLE);
    await expect(fetchStyle("team 1")).resolves.toEqual(DEFAULT_STYLE);
    expect(call().url).toBe("/api/style?space=team%201");
    for (const body of [{}, { ...DEFAULT_STYLE, profile: null }, { ...DEFAULT_STYLE, notes: 5 }, { ...DEFAULT_STYLE, updatedAt: 1 }, { ...DEFAULT_STYLE, updatedByName: null }, []]) {
      answer(200, body);
      await expect(fetchStyle("team1"), JSON.stringify(body)).rejects.toThrow("Your style couldn't be loaded. Try again.");
    }
  });

  it("saves a change and answers the style", async () => {
    const saved = { ...DEFAULT_STYLE, profile: { pace: "quick" }, updatedAt: "2026-11-25T10:00:00.000Z", updatedBy: "u1" };
    const { call } = answer(200, saved);
    await expect(saveStyle("team1", { profile: { pace: "quick" } })).resolves.toEqual(saved);
    expect(call()).toEqual({ url: "/api/style?space=team1", method: "PATCH", body: { profile: { pace: "quick" } } });
  });

  it("a refusal throws the server's words", async () => {
    answer(400, { code: "INVALID", message: "Pace: Invalid option." });
    await expect(saveStyle("team1", { profile: { pace: "slow" as never } })).rejects.toThrow("Pace: Invalid option.");
    answer(500, null);
    await expect(saveStyle("team1", {})).rejects.toThrow("Your style couldn't be saved. Try again.");
    answer(404, { code: "NOT_FOUND", message: "That isn't in your style anymore." });
    await expect(removeReference("r1")).rejects.toThrow("That isn't in your style anymore.");
  });

  it("lists, adds and removes references", async () => {
    let { call } = answer(200, { references: [REFERENCE] });
    await expect(fetchReferences("team1")).resolves.toEqual([REFERENCE]);
    expect(call().url).toBe("/api/style/references?space=team1");

    answer(200, { references: [{ id: "r1" }] });
    await expect(fetchReferences("team1")).rejects.toThrow();

    ({ call } = answer(201, { reference: REFERENCE }));
    await expect(addReference("team1", { kind: "link", url: "https://youtu.be/abcdefghijk" })).resolves.toEqual(REFERENCE);
    expect(call()).toEqual({ url: "/api/style/references?space=team1", method: "POST", body: { kind: "link", url: "https://youtu.be/abcdefghijk" } });

    ({ call } = answer(204, undefined));
    await expect(removeReference("r/1")).resolves.toBeUndefined();
    expect(call()).toMatchObject({ url: "/api/style/references/r%2F1", method: "DELETE" });
  });

  it("sends a video's measurements with its strip as base64, or says why it failed", async () => {
    const ready = { ...REFERENCE, status: "ready", hasSheet: true, analysis: MEASURED };
    let { call } = answer(200, { reference: ready });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4]);
    await expect(saveAnalysis("r1", MEASURED, new Blob([jpeg], { type: "image/jpeg" }))).resolves.toEqual(ready);
    const sent = call();
    expect(sent).toMatchObject({ url: "/api/style/references/r1/analysis", method: "PUT" });
    expect(sent.body.analysis).toEqual(MEASURED);
    expect(unpackBytes(sent.body.sheet)).toEqual(jpeg);

    ({ call } = answer(200, { reference: ready }));
    await saveAnalysis("r1", MEASURED, null);
    expect(call().body).toEqual({ analysis: MEASURED });

    const failed = { ...REFERENCE, status: "failed", failure: "No sound." };
    ({ call } = answer(200, { reference: failed }));
    await expect(failAnalysis("r1", "No sound.")).resolves.toEqual(failed);
    expect(call()).toEqual({ url: "/api/style/references/r1/analysis", method: "PUT", body: { failed: "No sound." } });

    answer(502, null);
    await expect(saveAnalysis("r1", MEASURED, null)).rejects.toThrow("What we found in that video couldn't be saved. Try again.");
  });

  it("reads who changed the style last, by name", async () => {
    const saved = { ...DEFAULT_STYLE, profile: {}, updatedAt: "2026-11-25T10:00:00.000Z", updatedBy: "claude:u1", updatedByName: "Claude (for Ada)" };
    answer(200, saved);
    await expect(fetchStyle("team1")).resolves.toEqual(saved);
  });

  it("names where a strip of frames is served", () => {
    expect(sheetUrl("r1")).toBe("/api/style/references/r1/sheet");
    expect(sheetUrl("r1", "2026-11-25T10:00:00.000Z")).toBe("/api/style/references/r1/sheet?v=2026-11-25T10%3A00%3A00.000Z");
  });
});
