import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { assetTranscripts } from "@/db/schema";
import { requireRole, type Actor } from "@/lib/actor";
import { libraryAsset } from "@/lib/media/service";
import { ServiceError } from "@/lib/service-error";
import { CaptionWords, type CaptionWord } from "@/lib/timeline";

export type SavedTranscript = { words: CaptionWord[]; model: string };

const MODEL_MAX_CHARS = 100;
const invalid = (message: string) => new ServiceError("INVALID", 400, message);

// The saved words of a file in the actor's library, or null when none were saved. A file that is not in the library
// is answered as the media routes answer it.
export async function getTranscript(db: DB, actor: Actor, assetId: string): Promise<SavedTranscript | null> {
  requireRole(actor, "viewer");
  await libraryAsset(db, actor, assetId);
  const [row] = await db.select({ words: assetTranscripts.words, model: assetTranscripts.model }).from(assetTranscripts).where(eq(assetTranscripts.assetId, assetId));
  return row ?? null;
}

// Keeps the words of a finished video or audio file, replacing any saved before. The first saver stays the creator.
export async function saveTranscript(db: DB, actor: Actor, assetId: string, input: SavedTranscript): Promise<void> {
  requireRole(actor, "editor");
  const asset = await libraryAsset(db, actor, assetId);
  if (asset.status !== "ready" || (asset.kind !== "video" && asset.kind !== "audio")) throw invalid("Only a finished video or audio file has words to save.");
  const words = CaptionWords.safeParse(input.words);
  if (!words.success) throw invalid(words.error.issues[0]?.message ?? "These words are not valid.");
  const model = input.model;
  if (model.length < 1 || model.length > MODEL_MAX_CHARS) throw invalid(`The model name must be 1 to ${MODEL_MAX_CHARS} characters.`);

  const now = new Date();
  await db
    .insert(assetTranscripts)
    .values({ assetId, spaceId: actor.spaceId, words: words.data, model, createdBy: actor.userId, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: assetTranscripts.assetId, set: { words: words.data, model, updatedAt: now } });
}

// The saved words of each of these files that has some, for files of this space only. Saved words that are an empty
// list count as none. No role check: callers have checked the actor already.
export async function loadTranscripts(db: DB, spaceId: string, assetIds: string[]): Promise<Map<string, CaptionWord[]>> {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ assetId: assetTranscripts.assetId, words: assetTranscripts.words })
    .from(assetTranscripts)
    .where(and(eq(assetTranscripts.spaceId, spaceId), inArray(assetTranscripts.assetId, ids)));
  return new Map(rows.filter((row) => row.words.length > 0).map((row) => [row.assetId, row.words]));
}
