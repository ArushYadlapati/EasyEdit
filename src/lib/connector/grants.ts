import { sql, type SQL } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";

// Imports only the database, so the allowlist service can call it without a cycle.

// The OAuth provider keeps each unexchanged authorization code as a verification row whose value is the JSON text
// {"type":"authorization_code","query":{"client_id":...,...},"userId":...,...}. Other verification rows need not be
// JSON, so only a row that starts that way is parsed, and the CASE keeps the parse from running on any other row.
const isCodeWhere = (matches: SQL) => sql`case when starts_with(value, '{"type":"authorization_code",')
  then ${matches} else false end`;

// Ends a member's connector access in one statement: their tokens (OAuth and personal access tokens), consent and
// unexchanged sign-in codes, and their website sessions when asked. Access tokens tied to a refresh token would also go
// by cascade; deleting them directly covers the rest.
export async function revokeAccess(
  db: DB,
  who: { email: string } | { userId: string },
  opts: { sessions: boolean },
): Promise<void> {
  const target = "email" in who
    ? sql`select id from "user" where lower(email) = ${who.email.trim().toLowerCase()}`
    : sql`select id from "user" where id = ${who.userId}`;
  const sessions = opts.sessions
    ? sql`, gone_sessions as (delete from session where user_id in (select id from target))`
    : sql``;
  await db.execute(sql`
    with target as (${target})${sessions},
      gone_access as (delete from oauth_access_token where user_id in (select id from target)),
      gone_refresh as (delete from oauth_refresh_token where user_id in (select id from target)),
      gone_consent as (delete from oauth_consent where user_id in (select id from target)),
      gone_agent_tokens as (delete from agent_token where user_id in (select id from target)),
      gone_codes as (delete from verification where ${isCodeWhere(sql`(value::jsonb ->> 'userId') in (select id from target)`)})
    select 1
  `);
}

// Ends one agent's access for one member: its tokens, refresh tokens, consent and unexchanged codes for that client only.
// The member's other agents, and other members of the same client, stay connected.
export async function revokeClientGrant(db: DB, userId: string, clientId: string): Promise<void> {
  const ofCode = sql`(value::jsonb ->> 'userId') = ${userId} and (value::jsonb -> 'query' ->> 'client_id') = ${clientId}`;
  await db.execute(sql`
    with gone_access as (delete from oauth_access_token where user_id = ${userId} and client_id = ${clientId}),
      gone_refresh as (delete from oauth_refresh_token where user_id = ${userId} and client_id = ${clientId}),
      gone_consent as (delete from oauth_consent where user_id = ${userId} and client_id = ${clientId}),
      gone_codes as (delete from verification where ${isCodeWhere(ofCode)})
    select 1
  `);
}

// Deletes the apps that registered more than the given days ago and were never used, or no longer are: no consent, no
// token and no unexchanged sign-in code names them. An app with no creation time counts as old. Rows that hang off an
// app go with it by cascade. Times are compared with the app's clock, in UTC, as the app stores them.
export async function pruneUnusedClients(db: DB, olderThanDays = 7): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const namesClient = sql`(value::jsonb -> 'query' ->> 'client_id') = c.client_id`;
  await db.execute(sql`
    delete from oauth_client c
    where (c.created_at is null or c.created_at < ${cutoff}::timestamp)
      and not exists (select 1 from oauth_consent k where k.client_id = c.client_id)
      and not exists (select 1 from oauth_access_token a where a.client_id = c.client_id)
      and not exists (select 1 from oauth_refresh_token r where r.client_id = c.client_id)
      and not exists (select 1 from verification where ${isCodeWhere(namesClient)})
  `);
}

// Lowercase emails of the members who have a live grant: an OAuth consent, or a personal access token that has not
// expired. Expiry is compared with the app's clock, in UTC, as the app stores it.
export async function connectedEmails(db: DB): Promise<Set<string>> {
  const now = new Date().toISOString();
  const rows = rowsOf<{ email: string }>(await db.execute(sql`
    select lower(u.email) as email from oauth_consent c join "user" u on u.id = c.user_id
    union
    select lower(u.email) as email from agent_token t join "user" u on u.id = t.user_id
      where t.expires_at is null or t.expires_at > ${now}::timestamp
  `));
  return new Set(rows.map((r) => r.email));
}
