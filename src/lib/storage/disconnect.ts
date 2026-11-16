import "server-only";
import { sql } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";
import { assets } from "@/db/schema";
import { ServiceError } from "@/lib/service-error";
import { roleIn } from "@/lib/spaces/service";
import type { StorageConfig } from "./config";
import { revokeGrant } from "./google-oauth";
import { open } from "./secret-box";
import { forgetSources } from "./token-cache";

// Takes a space's storage off the Google account it is in: the space has no storage again, EasyEdit's access to the
// account is revoked at Google and its token deleted. The folder and anything in it stay in that Drive (EasyEdit never
// deletes a folder in someone's Drive). Only while the space holds no videos, and only by the person who connected
// the account (an admin of the space). What it refuses comes out as a ServiceError.
export type DisconnectStorage = (db: DB, input: { spaceId: string; byUserId: string }) => Promise<void>;

export type DisconnectDeps = {
  config: StorageConfig;
  revoke?: (refreshToken: string) => Promise<void>; // Google's revoke; revokeGrant unless a test gives one
};

const notFound = () => new ServiceError("NOT_FOUND", 404, "Space not found");
const noStorage = () => new ServiceError("NO_STORAGE", 409, "This space has no Google account to disconnect.");
const notOwner = () => new ServiceError("NOT_OWNER", 403, "Only the person who connected this Google account can disconnect it.");
const hasUploads = () => new ServiceError("HAS_UPLOADS", 409, "This space has videos in that Google Drive, so it can't be disconnected yet.");

type Row = { owner: string | null; connection_id: string | null; held: boolean; removed: boolean; sealed: string | null; connection_gone: boolean };

export function makeDisconnectStorage(deps: DisconnectDeps): DisconnectStorage {
  const revoke = deps.revoke ?? ((token: string) => revokeGrant(token));
  return async (db, { spaceId, byUserId }) => {
    if ((await roleIn(db, byUserId, spaceId)) !== "admin") throw notFound();
    // One statement: the space's Google storage goes only if the caller connected it and the space holds no upload
    // (finished or not, not removed); its connection goes too when no other space uses it. Read back what blocked it.
    const uploads = sql`exists (select 1 from ${assets} where ${assets.spaceId} = ${spaceId} and ${assets.removedAt} is null)`;
    const result = await db.execute(sql`
      with target as (
        select ss.space_id, ss.connection_id, dc.user_id, dc.refresh_token_enc
        from space_storage ss join drive_connection dc on dc.id = ss.connection_id
        where ss.space_id = ${spaceId} and ss.kind = 'google_account'
      ),
      gone as (
        delete from space_storage ss using target t
        where ss.space_id = t.space_id and t.user_id = ${byUserId} and not ${uploads}
        returning ss.connection_id
      ),
      gone_connection as (
        delete from drive_connection dc using gone g
        where dc.id = g.connection_id
          and not exists (select 1 from space_storage other where other.connection_id = g.connection_id and other.space_id <> ${spaceId})
        returning dc.id
      )
      select
        (select user_id from target) as owner,
        (select connection_id from target) as connection_id,
        (select refresh_token_enc from target) as sealed,
        ${uploads} as held,
        exists (select 1 from gone) as removed,
        exists (select 1 from gone_connection) as connection_gone
    `);
    const row = rowsOf<Row>(result)[0];
    if (!row || row.owner === null) throw noStorage();
    if (!row.removed) {
      if (row.owner !== byUserId) throw notOwner();
      if (row.held) throw hasUploads();
      throw noStorage(); // taken off by someone else while this ran
    }
    if (row.connection_id) forgetSources(`connection:${row.connection_id}:`);
    if (!row.connection_gone || row.sealed === null) return;
    // Best effort, after the rows are gone: a token the server's key can't open, or Google refusing, doesn't undo the
    // disconnect. The person can still remove EasyEdit in their Google account.
    let refreshToken: string;
    try {
      refreshToken = open(row.sealed, deps.config.tokenKey);
    } catch {
      return;
    }
    try {
      await revoke(refreshToken);
    } catch (error) {
      console.error("Revoking a disconnected Google account failed:", error instanceof Error ? error.message : "unknown");
    }
  };
}
