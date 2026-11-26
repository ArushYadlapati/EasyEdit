import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/access-rules";
import { packBytes } from "@/lib/color/cube";
import { LIMITS } from "@/lib/limits";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { makeStyleHandlers } from "@/lib/style/handlers";
import { STYLE_MESSAGES } from "@/lib/style/messages";
import { DEFAULT_STYLE, type VideoAnalysis } from "@/lib/style/types";
import { joinSpace, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { insertAsset } from "../media/context";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const MEASURED: VideoAnalysis = {
  kind: "video",
  seconds: 12.5,
  width: 1080,
  height: 1920,
  shots: { count: 3, averageSeconds: 4.2, medianSeconds: 4, firstSeconds: 2.5, perMinute: 14.4 },
  cuts: [2.5, 8],
  speech: null,
  sound: null,
  color: { brightness: 0.5, saturation: 0.4, warmth: 0.1 },
  sheet: { times: [0.2, 5, 10], columns: 3, rows: 1 },
  analyzedAt: "2026-11-25T10:00:00.000Z",
};

async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "ed" }, "editor");
  await joinSpace(db, { id: "vi" }, "viewer");
  await joinSpace(db, { id: "out" }, "admin", personalSpaceId("out"));
  let current: CurrentUser = testUser({ id: "ed" });
  const site = vi.fn(async () => new Response(JSON.stringify({ title: "Match day recap", author_name: "Seattle Solvers" }), { status: 200 }));
  const style = makeStyleHandlers({ db: () => db, auth: vi.fn(async () => current), fetch: site as unknown as typeof fetch });
  const as = (id: string) => (current = testUser({ id }));
  const video = () => insertAsset(db, { uploadedBy: "ed" });
  return { db, style, as, site, video };
}

type Style = Awaited<ReturnType<typeof setup>>["style"];

const base = "http://x/api/style";
const inSpace = (path: string, space: string | null) => `${base}${path}${space === null ? "" : `?space=${space}`}`;
const send = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined && { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
const at = (id: string) => ({ params: Promise.resolve({ id }) });
const read = async (r: Response) => ({ status: r.status, body: r.status === 204 ? null : await r.json() });

// Adds a video as the editor and answers the new reference's id.
async function addVideo(style: Style, assetId: string): Promise<string> {
  const r = await read(await style.addReference(send(inSpace("/references", SEED_TEAM_ID), "POST", { kind: "video", assetId })));
  expect(r.status).toBe(201);
  return r.body.reference.id;
}

const analysis = (style: Style, id: string, body: unknown, headers: Record<string, string> = {}) =>
  style.analysis(send(`${base}/references/${id}/analysis`, "PUT", body, headers), at(id));

describe("/api/style", () => {
  it("a member reads the style, and an editor changes it", async () => {
    const { style, as } = await setup();
    as("vi");
    expect(await read(await style.get(send(inSpace("", SEED_TEAM_ID), "GET")))).toEqual({ status: 200, body: DEFAULT_STYLE });
    as("ed");
    const r = await read(await style.patch(send(inSpace("", SEED_TEAM_ID), "PATCH", { profile: { pace: "quick" }, notes: "Bright." })));
    expect(r).toMatchObject({ status: 200, body: { profile: { pace: "quick" }, notes: "Bright.", updatedBy: "ed", updatedByName: "ED" } });
    as("vi");
    expect((await read(await style.get(send(inSpace("", SEED_TEAM_ID), "GET")))).body.profile).toEqual({ pace: "quick" });
  });

  it("an editor adds, lists and removes references", async () => {
    const { style, site, video } = await setup();
    const videoId = await addVideo(style, await video());
    const link = await read(await style.addReference(send(inSpace("/references", SEED_TEAM_ID), "POST", { kind: "link", url: "https://youtu.be/abcdefghijk" })));
    expect(link).toMatchObject({ status: 201, body: { reference: { kind: "link", title: "Match day recap", author: "Seattle Solvers" } } });
    expect(site).toHaveBeenCalledTimes(1);
    const list = await read(await style.references(send(inSpace("/references", SEED_TEAM_ID), "GET")));
    expect(list.body.references.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([videoId, link.body.reference.id]));
    expect(await read(await style.removeReference(send(`${base}/references/${videoId}`, "DELETE"), at(videoId)))).toEqual({ status: 204, body: null });
    expect((await read(await style.references(send(inSpace("/references", SEED_TEAM_ID), "GET")))).body.references).toHaveLength(1);
  });

  it("a browser saves what it measured, and the strip is served as a JPEG", async () => {
    const { style, as, video } = await setup();
    const id = await addVideo(style, await video());
    const saved = await read(await analysis(style, id, { analysis: MEASURED, sheet: packBytes(JPEG) }));
    expect(saved).toMatchObject({ status: 200, body: { reference: { status: "ready", hasSheet: true, analysis: MEASURED } } });
    as("vi");
    const sheet = await style.sheet(send(`${base}/references/${id}/sheet`, "GET"), at(id));
    expect(sheet.status).toBe(200);
    expect(sheet.headers.get("content-type")).toBe("image/jpeg");
    expect(sheet.headers.get("cache-control")).toBe("private, max-age=300");
    expect(sheet.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await sheet.arrayBuffer())).toEqual(JPEG);
  });

  it("a browser that couldn't measure a video says why", async () => {
    const { style, video } = await setup();
    const id = await addVideo(style, await video());
    expect(await read(await analysis(style, id, { failed: "The sound couldn't be read." }))).toMatchObject({
      status: 200,
      body: { reference: { status: "failed", failure: "The sound couldn't be read." } },
    });
    // No strip yet.
    expect((await style.sheet(send(`${base}/references/${id}/sheet`, "GET"), at(id))).status).toBe(404);
  });

  it("someone not in the space gets what an unknown space or reference gets", async () => {
    const { style, as, video } = await setup();
    const id = await addVideo(style, await video());
    as("out");
    const unknownSpace = await read(await style.get(send(inSpace("", "never-existed"), "GET")));
    expect(unknownSpace.status).toBe(404);
    for (const r of [
      await style.get(send(inSpace("", SEED_TEAM_ID), "GET")),
      await style.get(send(inSpace("", null), "GET")),
      await style.patch(send(inSpace("", SEED_TEAM_ID), "PATCH", { notes: "x" })),
      await style.references(send(inSpace("/references", SEED_TEAM_ID), "GET")),
      await style.addReference(send(inSpace("/references", SEED_TEAM_ID), "POST", { kind: "link", url: "https://youtu.be/abcdefghijk" })),
    ]) {
      expect(await read(r)).toEqual(unknownSpace);
    }
    const unknownReference = await read(await style.sheet(send(`${base}/references/never-existed/sheet`, "GET"), at("never-existed")));
    expect(unknownReference).toEqual({ status: 404, body: { code: "NOT_FOUND", message: STYLE_MESSAGES.referenceGone } });
    for (const r of [
      await style.sheet(send(`${base}/references/${id}/sheet`, "GET"), at(id)),
      await style.removeReference(send(`${base}/references/${id}`, "DELETE"), at(id)),
      await analysis(style, id, { failed: "x" }),
    ]) {
      expect(await read(r)).toEqual(unknownReference);
    }
  });

  it("a viewer's changes are 403", async () => {
    const { style, as, video } = await setup();
    const id = await addVideo(style, await video());
    as("vi");
    for (const r of [
      await style.patch(send(inSpace("", SEED_TEAM_ID), "PATCH", { notes: "x" })),
      await style.addReference(send(inSpace("/references", SEED_TEAM_ID), "POST", { kind: "video", assetId: "a" })),
      await style.removeReference(send(`${base}/references/${id}`, "DELETE"), at(id)),
      await analysis(style, id, { analysis: MEASURED }),
      await analysis(style, id, "not even json"),
    ]) {
      expect(r.status).toBe(403);
    }
  });

  it("a bad body is 400", async () => {
    const { style, video } = await setup();
    const id = await addVideo(style, await video());
    const cases: [Promise<Response>, string?][] = [
      [style.patch(send(inSpace("", SEED_TEAM_ID), "PATCH", "not json")), "Body must be valid JSON"],
      [style.patch(send(inSpace("", SEED_TEAM_ID), "PATCH", { extra: 1 })), STYLE_MESSAGES.notAStyleChange],
      [style.patch(send(inSpace("", SEED_TEAM_ID), "PATCH", { profile: "quick" })), STYLE_MESSAGES.notAStyleChange],
      [style.patch(send(inSpace("", SEED_TEAM_ID), "PATCH", { notes: 5 })), STYLE_MESSAGES.notAStyleChange],
      [style.patch(send(inSpace("", SEED_TEAM_ID), "PATCH", { profile: { pace: "slow" } }))],
      [style.addReference(send(inSpace("/references", SEED_TEAM_ID), "POST", { kind: "file", url: "x" })), STYLE_MESSAGES.notAStyleChange],
      [style.addReference(send(inSpace("/references", SEED_TEAM_ID), "POST", { kind: "link", url: "https://instagram.com/p/abc" })), STYLE_MESSAGES.instagram],
      [style.addReference(send(inSpace("/references", SEED_TEAM_ID), "POST", { kind: "link", url: `https://youtu.be/abcdefghijk?x=${"a".repeat(3000)}` })), STYLE_MESSAGES.badLink],
      [style.addReference(send(inSpace("/references", SEED_TEAM_ID), "POST", "{")), "Body must be valid JSON"],
      [analysis(style, id, { analysis: MEASURED, failed: "both" }), STYLE_MESSAGES.badAnalysis],
      [analysis(style, id, { analysis: MEASURED, sheet: "not base64!" }), STYLE_MESSAGES.badAnalysis],
      [analysis(style, id, { analysis: MEASURED, sheet: "A".repeat(Math.ceil(LIMITS.styleSheetBytes / 3) * 4 + 4) }), STYLE_MESSAGES.sheetTooBig],
      [analysis(style, id, { analysis: MEASURED }, { "content-length": String(10_000_000) }), STYLE_MESSAGES.sheetTooBig],
      [analysis(style, id, { analysis: { ...MEASURED, seconds: -1 } }), STYLE_MESSAGES.badAnalysis],
    ];
    for (const [response, message] of cases) {
      const r = await read(await response);
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.code).toBe("INVALID");
      if (message) expect(r.body.message).toBe(message);
    }
  });

  it("a change from another site is refused", async () => {
    const { style, video } = await setup();
    const id = await addVideo(style, await video());
    const evil = { origin: "https://evil.example" };
    for (const r of [
      await style.patch(send(inSpace("", SEED_TEAM_ID), "PATCH", { notes: "x" }, evil)),
      await style.addReference(send(inSpace("/references", SEED_TEAM_ID), "POST", { kind: "video", assetId: "a" }, evil)),
      await style.removeReference(send(`${base}/references/${id}`, "DELETE", undefined, evil), at(id)),
      await analysis(style, id, { failed: "x" }, evil),
    ]) {
      expect(r.status).toBe(403);
    }
  });
});
