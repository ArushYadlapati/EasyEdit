import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { brandKit } from "@/db/schema";
import { requireRole, type Actor } from "@/lib/actor";
import { listAssets } from "@/lib/media/service";
import type { AssetView } from "@/lib/media/types";
import { ServiceError } from "@/lib/service-error";
import { isListedFont } from "./fonts";
import { BRAND_MESSAGES } from "./messages";
import { BRAND_LIMITS, DEFAULT_BRAND_FONTS, HEX_COLOR, type BrandFonts, type BrandKit, type BrandKitPatch } from "./types";

export { BRAND_LIMITS } from "./types";

const invalid = (message: string) => new ServiceError("INVALID", 400, message);

// An image that can be a logo: finished, not removed, in the actor's space (listAssets only answers for that space).
const usableLogo = (view: AssetView) => view.kind === "image" && view.status === "ready" && !view.removed;

// The kit's logo ids as images, in the kit's order, leaving out any that can no longer be a logo.
async function logosOf(db: DB, actor: Actor, ids: string[]): Promise<AssetView[]> {
  if (ids.length === 0) return [];
  const views = new Map((await listAssets(db, actor, { ids })).filter(usableLogo).map((v) => [v.id, v]));
  return ids.flatMap((id) => views.get(id) ?? []);
}

// Any member's view of their space's kit; the default kit when nobody has changed it.
export async function getBrandKit(db: DB, actor: Actor): Promise<BrandKit> {
  requireRole(actor, "viewer");
  const [row] = await db.select().from(brandKit).where(eq(brandKit.spaceId, actor.spaceId));
  if (!row) return { fonts: DEFAULT_BRAND_FONTS, colors: [], logos: [], updatedAt: null };
  return {
    fonts: { title: row.titleFont, subtitle: row.subtitleFont, body: row.bodyFont },
    colors: row.colors,
    logos: await logosOf(db, actor, row.logoAssetIds),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function checkFont(family: string | undefined): void {
  if (family !== undefined && !isListedFont(family)) throw invalid(BRAND_MESSAGES.unknownFont(family));
}

// Lowercase, each once, in the order given.
function checkColors(colors: string[]): string[] {
  for (const color of colors) if (!HEX_COLOR.test(color)) throw invalid(BRAND_MESSAGES.badColor(color));
  const kept = [...new Set(colors.map((c) => c.toLowerCase()))];
  if (kept.length > BRAND_LIMITS.colors) throw invalid(BRAND_MESSAGES.tooManyColors);
  return kept;
}

// The logos to keep, each once, in the order given. A logo the kit already had whose image has since gone (removed
// from the library) is dropped quietly: a page that still shows it must not be stuck. A logo not in the kit before
// must be a usable image.
async function checkLogos(db: DB, actor: Actor, ids: string[]): Promise<string[]> {
  const wanted = [...new Set(ids)];
  if (wanted.length > BRAND_LIMITS.logos) throw invalid(BRAND_MESSAGES.tooManyLogos);
  const usable = new Set((await logosOf(db, actor, wanted)).map((l) => l.id));
  const [row] = await db.select({ ids: brandKit.logoAssetIds }).from(brandKit).where(eq(brandKit.spaceId, actor.spaceId));
  const before = new Set(row?.ids ?? []);
  if (wanted.some((id) => !usable.has(id) && !before.has(id))) throw invalid(BRAND_MESSAGES.badLogo);
  return wanted.filter((id) => usable.has(id));
}

// An editor's change to their space's kit. Each field given replaces the one kept, so two people changing different
// parts at once don't undo each other. Answers the kit as it now is.
export async function updateBrandKit(db: DB, actor: Actor, patch: BrandKitPatch): Promise<BrandKit> {
  requireRole(actor, "editor");
  checkFont(patch.titleFont);
  checkFont(patch.subtitleFont);
  checkFont(patch.bodyFont);
  const colors = patch.colors === undefined ? undefined : checkColors(patch.colors);
  const logoAssetIds = patch.logoAssetIds === undefined ? undefined : await checkLogos(db, actor, patch.logoAssetIds);

  const set = {
    ...(patch.titleFont !== undefined && { titleFont: patch.titleFont }),
    ...(patch.subtitleFont !== undefined && { subtitleFont: patch.subtitleFont }),
    ...(patch.bodyFont !== undefined && { bodyFont: patch.bodyFont }),
    ...(colors !== undefined && { colors }),
    ...(logoAssetIds !== undefined && { logoAssetIds }),
    updatedAt: new Date(),
    updatedBy: actor.userId,
  };
  const fonts: BrandFonts = DEFAULT_BRAND_FONTS;
  await db
    .insert(brandKit)
    .values({ spaceId: actor.spaceId, titleFont: fonts.title, subtitleFont: fonts.subtitle, bodyFont: fonts.body, ...set })
    .onConflictDoUpdate({ target: brandKit.spaceId, set });
  return getBrandKit(db, actor);
}
