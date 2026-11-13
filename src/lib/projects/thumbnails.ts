import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";
import { projects } from "@/db/schema";
import { requireRole, type Actor } from "@/lib/actor";
import { LIMITS } from "@/lib/limits";
import { ServiceError } from "@/lib/service-error";

// Each project's dashboard picture: a small JPEG of one frame of a saved version, drawn by an editor's browser.

export const THUMBNAIL_NOT_JPEG = "A thumbnail must be a JPEG.";
export const THUMBNAIL_TOO_LARGE = `A thumbnail can be at most ${LIMITS.thumbnailBytes / 1024} KB.`;

// A JPEG starts FF D8 FF.
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// Keeps the picture only if the project is live, the picture is newer than the stored one, and its version is not
// past the project's. It never touches the version, who changed the project or when, or the op log. Bytes equal to
// the stored ones are left where they are, so a newer version with the same picture writes no new copy.
export async function saveThumbnail(
  db: DB,
  actor: Actor,
  id: string,
  version: number,
  jpeg: Uint8Array<ArrayBuffer>,
): Promise<{ saved: boolean }> {
  requireRole(actor, "editor");
  if (jpeg.byteLength > LIMITS.thumbnailBytes) throw new ServiceError("LIMIT_EXCEEDED", 400, THUMBNAIL_TOO_LARGE);
  if (!isJpeg(jpeg)) throw new ServiceError("INVALID", 400, THUMBNAIL_NOT_JPEG);
  const result = await db.execute(sql`
    update projects
    set thumbnail = case when thumbnail = ${jpeg}::bytea then thumbnail else ${jpeg}::bytea end,
        thumbnail_version = ${version}::integer
    where id = ${id}::text and deleted_at is null
      and coalesce(thumbnail_version, -1) < ${version}::integer and ${version}::integer <= version
    returning id
  `);
  return { saved: rowsOf(result).length > 0 };
}

// The stored picture and the version it was drawn from, or null when the project has none, is deleted or is unknown.
// The only read of the bytes.
export async function readThumbnail(
  db: DB,
  actor: Actor,
  id: string,
): Promise<{ jpeg: Uint8Array<ArrayBuffer>; version: number } | null> {
  requireRole(actor, "viewer");
  const rows = await db
    .select({ jpeg: projects.thumbnail, version: projects.thumbnailVersion })
    .from(projects)
    .where(and(eq(projects.id, id), isNull(projects.deletedAt), isNotNull(projects.thumbnail)));
  const row = rows[0];
  if (!row?.jpeg || row.version === null) return null;
  return { jpeg: row.jpeg, version: row.version };
}
