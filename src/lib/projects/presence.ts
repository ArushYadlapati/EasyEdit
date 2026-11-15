import { sql } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";
import { requireRole, type Actor } from "@/lib/actor";
import { LIMITS } from "@/lib/limits";
import { failedOn, getProjectVersion } from "@/lib/projects/service";
import { ServiceError } from "@/lib/service-error";

export type Share = { tabId: string; clipIds: string[]; trackId: string | null; changedAgoMs: number }; // already cleaned
export type PeerRow = { userId: string; name: string; clipIds: string[]; trackId: string | null };
export type PresenceTimes = { ttlMs: number; refreshMs: number; keepMs: number }; // LIMITS by default; tests pass small ones
export type PresenceOptions = { times?: PresenceTimes; breaker?: PresenceBreaker };

export type PresenceBreaker = {
  isOpen(): boolean; // true while presence is off in this instance
  trip(error: unknown): void; // turns presence off for a while, and logs once per spell
};

const DEFAULT_TIMES: PresenceTimes = {
  ttlMs: LIMITS.presenceTtlMs,
  refreshMs: LIMITS.presenceRefreshMs,
  keepMs: LIMITS.presenceKeepMs,
};

// A missing table stays missing until someone migrates, so it is not retried often. Anything else (a deadlock between
// two sweeps, a driver surprise, a timeout) is likely to pass.
const MISSING_TABLE_OFF_MS = 5 * 60_000;
const ERROR_OFF_MS = 60_000;

const MISSING_TABLE_MESSAGE =
  "The project_presence table is missing: run pnpm db:migrate. Teammates' selections are off until it exists.";

const isMissingTable = (error: unknown) => failedOn(error, "42P01", "project_presence");

// The first Postgres code on the error or its causes. Drivers may wrap the database error.
function codeOf(error: unknown): string | undefined {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    const { code } = e as { code?: unknown };
    if (typeof code === "string") return code;
  }
  return undefined;
}

// Turns presence off in this server instance for a while after an error, and logs at most once per spell.
export function createPresenceBreaker(clock: () => number = Date.now): PresenceBreaker {
  let offUntil = 0;
  return {
    isOpen: () => clock() < offUntil,
    trip(error) {
      const now = clock();
      const missing = isMissingTable(error);
      if (now >= offUntil) {
        if (missing) console.error(MISSING_TABLE_MESSAGE);
        else console.error("Teammates' selections are off for a minute after an error", codeOf(error) ?? "no code", error);
      }
      offUntil = Math.max(offUntil, now + (missing ? MISSING_TABLE_OFF_MS : ERROR_OFF_MS));
    },
  };
}

const TRANSIENT_CODES = new Set(["40P01", "40001"]); // deadlock detected, serialization failure

// Only ever turns presence off: the one piece of server memory this feature keeps.
const moduleBreaker = createPresenceBreaker(Date.now);

// neon-http and PGlite may hand json back parsed or as text.
function readPeers(value: unknown): PeerRow[] {
  const list = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(list) ? (list as PeerRow[]) : [];
}

// The editor's check for changes. With a share: one statement that writes this tab's row (only when the selection
// changed or the row is getting old), tidies old rows, and reads the version and the other people's selections.
// Without a share, while the breaker is open, or when that statement fails for any reason: the plain version, so
// nothing about presence can make the check fail. Null: the project is unknown or deleted.
export async function checkIn(
  db: DB,
  actor: Actor,
  projectId: string,
  share: Share | null,
  opts: PresenceOptions = {},
): Promise<{ version: number; peers?: PeerRow[] } | null> {
  requireRole(actor, "viewer");
  const breaker = opts.breaker ?? moduleBreaker;
  if (share && !breaker.isOpen()) {
    try {
      return await shareAndRead(db, actor, projectId, share, opts.times ?? DEFAULT_TIMES);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      // A deadlock or serialization failure is one unlucky check, not a broken feature: answer this one plainly.
      if (!TRANSIENT_CODES.has(codeOf(error) ?? "")) breaker.trip(error);
    }
  }
  const version = await getProjectVersion(db, actor, projectId);
  return version === null ? null : { version };
}

async function shareAndRead(
  db: DB,
  actor: Actor,
  projectId: string,
  share: Share,
  { ttlMs, refreshMs, keepMs }: PresenceTimes,
): Promise<{ version: number; peers: PeerRow[] } | null> {
  const me = actor.userId;
  const { tabId, trackId, changedAgoMs } = share;
  const clips = JSON.stringify(share.clipIds);
  const result = await db.execute(sql`
    with live as (
      select id, version from projects
      where id = ${projectId}::text and space_id = ${actor.spaceId}::text and deleted_at is null
    ),
    mine as (
      insert into project_presence as p (project_id, user_id, tab_id, clip_ids, track_id, changed_at, seen_at)
      select live.id, ${me}::text, ${tabId}::text, ${clips}::jsonb, ${trackId}::text,
             now() - ${changedAgoMs}::integer * interval '1 millisecond', now()
      from live
      -- Nothing to do (no lock, no transaction id) when the row is unchanged and recent, or the tab has left.
      where not exists (
        select 1 from project_presence q
        where q.project_id = live.id and q.user_id = ${me}::text and q.tab_id = ${tabId}::text
          and (q.left_at is not null
               or (q.clip_ids = ${clips}::jsonb and q.track_id is not distinct from ${trackId}::text
                   and q.seen_at >= now() - ${refreshMs}::integer * interval '1 millisecond')))
      on conflict (project_id, user_id, tab_id) do update set
        clip_ids = excluded.clip_ids,
        track_id = excluded.track_id,
        changed_at = case when (p.clip_ids, p.track_id) is distinct from (excluded.clip_ids, excluded.track_id)
                          then excluded.changed_at else p.changed_at end,
        seen_at = now()
      where p.left_at is null
    ),
    own_tidy as (
      -- This person's other tabs in this project: drop those not heard from for the TTL, and keep at most N in all.
      -- Skip locked, as the sweep does: two of one person's tabs checking at once (a laptop waking with both windows
      -- shown) would otherwise each lock the other's row here and then wait on it in their own upsert, a deadlock.
      delete from project_presence where (project_id, user_id, tab_id) in (
        select d.project_id, d.user_id, d.tab_id from project_presence d
        where d.project_id = ${projectId}::text and d.user_id = ${me}::text and d.tab_id <> ${tabId}::text
          and (d.seen_at < now() - ${ttlMs}::integer * interval '1 millisecond'
               or d.tab_id in (
                 select o.tab_id from project_presence o
                 where o.project_id = ${projectId}::text and o.user_id = ${me}::text and o.tab_id <> ${tabId}::text
                 order by o.seen_at desc
                 offset ${LIMITS.presenceTabsPerPerson - 1}::integer))
        for update skip locked)
    ),
    swept as (
      delete from project_presence where (project_id, user_id, tab_id) in (
        select project_id, user_id, tab_id from project_presence
        where seen_at < now() - ${keepMs}::integer * interval '1 millisecond'
          and not (project_id = ${projectId}::text and user_id = ${me}::text)
        limit ${LIMITS.presenceSweepRows}::integer
        for update skip locked)
    )
    select live.version, coalesce((
      select json_agg(json_build_object('userId', o.user_id, 'name', o.name, 'clipIds', o.clip_ids, 'trackId', o.track_id)
                      order by o.name, o.user_id)
      from (
        -- Each person once (their tab changed last), then the most recently changed people when there are too many.
        select * from (
          select distinct on (s.user_id) s.user_id, u.name, s.clip_ids, s.track_id, s.changed_at
          from project_presence s join "user" u on u.id = s.user_id
          where s.project_id = live.id and s.user_id <> ${me}::text and s.left_at is null
            and s.seen_at > now() - ${ttlMs}::integer * interval '1 millisecond'
          order by s.user_id, s.changed_at desc, s.seen_at desc
        ) latest
        order by latest.changed_at desc
        limit ${LIMITS.presencePeers}::integer
      ) o
    ), '[]'::json) as peers
    from live
  `);
  const [row] = rowsOf<{ version: number; peers: unknown }>(result);
  if (!row) return null;
  return { version: Number(row.version), peers: readPeers(row.peers) };
}

// Marks this person's tab as gone, so teammates stop seeing it and a late check from it writes nothing. Never fails.
// It inserts when no row exists yet, so a leave that lands before a share still in flight blocks that share.
export async function leavePresence(
  db: DB,
  actor: Actor,
  projectId: string,
  tabId: string,
  opts: PresenceOptions = {},
): Promise<void> {
  requireRole(actor, "viewer");
  const breaker = opts.breaker ?? moduleBreaker;
  if (breaker.isOpen()) return;
  try {
    await db.execute(sql`
      insert into project_presence (project_id, user_id, tab_id, clip_ids, track_id, changed_at, seen_at, left_at)
      select id, ${actor.userId}::text, ${tabId}::text, '[]'::jsonb, null, now(), now(), now()
      from projects where id = ${projectId}::text and space_id = ${actor.spaceId}::text and deleted_at is null
      on conflict (project_id, user_id, tab_id) do update set left_at = now(), seen_at = now()
    `);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (!TRANSIENT_CODES.has(codeOf(error) ?? "")) breaker.trip(error);
  }
}
