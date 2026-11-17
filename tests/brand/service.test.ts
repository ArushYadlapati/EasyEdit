import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { assets } from "@/db/schema";
import { BRAND_LIMITS, getBrandFonts, getBrandKit, updateBrandKit } from "@/lib/brand/service";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { insertAsset } from "../media/context";

const ada = testActor({ userId: "ada", email: "ada@gmail.com", role: "editor" });
const viewer = testActor({ userId: "vi", email: "vi@gmail.com", role: "viewer" });

async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "ada" }, "editor");
  await joinSpace(db, { id: "vi" }, "viewer");
  const image = (over: Parameters<typeof insertAsset>[1] = {}) =>
    insertAsset(db, { kind: "image", name: "Logo", fileName: "logo.png", mimeType: "image/png", durationMs: null, fps: null, hasAudio: false, videoCodec: null, previewStatus: "none", uploadedBy: "ada", ...over });
  return { db, image };
}

describe("brand kit service", () => {
  it("a space without a row gets the default kit", async () => {
    const { db } = await setup();
    expect(await getBrandKit(db, ada)).toEqual({ fonts: { title: "Geist", subtitle: "Geist", body: "Geist" }, colors: [], logos: [], updatedAt: null });
  });

  it("the fonts alone can be read, the default ones without a row", async () => {
    const { db } = await setup();
    expect(await getBrandFonts(db, viewer)).toEqual({ title: "Geist", subtitle: "Geist", body: "Geist" });
    await updateBrandKit(db, ada, { titleFont: "Orbitron", bodyFont: "Inter" });
    expect(await getBrandFonts(db, viewer)).toEqual({ title: "Orbitron", subtitle: "Geist", body: "Inter" });
  });

  it("an editor saves fonts, colors and logos", async () => {
    const { db, image } = await setup();
    const logo = await image();
    const kit = await updateBrandKit(db, ada, { titleFont: "Orbitron", bodyFont: "Inter", colors: ["#FF0000", "#00ff00", "#ff0000"], logoAssetIds: [logo] });
    expect(kit.fonts).toEqual({ title: "Orbitron", subtitle: "Geist", body: "Inter" });
    expect(kit.colors).toEqual(["#ff0000", "#00ff00"]);
    expect(kit.logos.map((l) => l.id)).toEqual([logo]);
    expect(kit.updatedAt).not.toBeNull();
    expect(await getBrandKit(db, viewer)).toEqual(kit);
  });

  it("keeps logos in the order they were given", async () => {
    const { db, image } = await setup();
    const a = await image({ name: "A" });
    const b = await image({ name: "B" });
    expect((await updateBrandKit(db, ada, { logoAssetIds: [b, a, b] })).logos.map((l) => l.id)).toEqual([b, a]);
  });

  it("patch only replaces the fields it names", async () => {
    const { db } = await setup();
    await updateBrandKit(db, ada, { titleFont: "Orbitron", colors: ["#111111"] });
    const kit = await updateBrandKit(db, ada, { colors: ["#222222"] });
    expect(kit.fonts.title).toBe("Orbitron");
    expect(kit.colors).toEqual(["#222222"]);
  });

  it("refuses bad input", async () => {
    const { db, image } = await setup();
    const video = await insertAsset(db, {});
    const removed = await image({ removedAt: new Date(), removedBy: "ada" });
    const uploading = await image({ status: "uploading", readyAt: null });
    await joinSpace(db, { id: "ada" }, "admin", personalSpaceId("ada"));
    const elsewhere = await image({ spaceId: personalSpaceId("ada") });
    const bad = [
      { titleFont: "Comic Sans MS" },
      { bodyFont: "" },
      { colors: ["red"] },
      { colors: ["#fff"] },
      { colors: Array.from({ length: BRAND_LIMITS.colors + 1 }, (_, i) => `#${i.toString(16).padStart(6, "0")}`) },
      { logoAssetIds: Array.from({ length: BRAND_LIMITS.logos + 1 }, (_, i) => `id${i}`) },
      { logoAssetIds: [video] },
      { logoAssetIds: [removed] },
      { logoAssetIds: [uploading] },
      { logoAssetIds: [elsewhere] },
      { logoAssetIds: ["never-existed"] },
    ];
    for (const patch of bad) {
      await expect(updateBrandKit(db, ada, patch), JSON.stringify(patch).slice(0, 60)).rejects.toMatchObject({ code: "INVALID", status: 400 });
    }
    expect((await getBrandKit(db, ada)).updatedAt).toBeNull();
  });

  it("a viewer reads but cannot write", async () => {
    const { db } = await setup();
    await expect(getBrandKit(db, viewer)).resolves.toMatchObject({ colors: [] });
    await expect(updateBrandKit(db, viewer, { colors: ["#000000"] })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("a logo removed later drops out of the kit", async () => {
    const { db, image } = await setup();
    const logo = await image();
    await updateBrandKit(db, ada, { logoAssetIds: [logo] });
    await db.update(assets).set({ removedAt: new Date(), removedBy: "ada" }).where(eq(assets.id, logo));
    expect((await getBrandKit(db, ada)).logos).toEqual([]);
  });

  it("a logo removed after it was saved doesn't block the next change, but a newly added one is still refused", async () => {
    const { db, image } = await setup();
    const a = await image({ name: "A" });
    const b = await image({ name: "B" });
    await updateBrandKit(db, ada, { logoAssetIds: [a] });
    await db.update(assets).set({ removedAt: new Date(), removedBy: "ada" }).where(eq(assets.id, a));
    // A page that still shows A sends it back with B: A is dropped quietly, B is kept.
    expect((await updateBrandKit(db, ada, { logoAssetIds: [a, b] })).logos.map((l) => l.id)).toEqual([b]);
    const c = await image({ name: "C", removedAt: new Date(), removedBy: "ada" });
    await expect(updateBrandKit(db, ada, { logoAssetIds: [b, c] })).rejects.toMatchObject({ code: "INVALID", status: 400 });
  });

  it("kits are per space", async () => {
    const { db } = await setup();
    await joinSpace(db, { id: "ada" }, "admin", personalSpaceId("ada"));
    await updateBrandKit(db, ada, { titleFont: "Orbitron" });
    const personal = testActor({ userId: "ada", email: "ada@gmail.com", role: "admin", spaceId: personalSpaceId("ada") });
    expect((await getBrandKit(db, personal)).fonts.title).toBe("Geist");
    expect((await getBrandKit(db, ada)).fonts.title).toBe("Orbitron");
    expect(ada.spaceId).toBe(SEED_TEAM_ID);
  });
});
