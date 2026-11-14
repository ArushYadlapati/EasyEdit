import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rowsOf, type DB } from "@/db";
import { user } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import { LIMITS } from "@/lib/limits";
import { checkIn, createPresenceBreaker, leavePresence, type Share } from "@/lib/projects/presence";
import { createProject, deleteProject } from "@/lib/projects/service";
import { makeTestDb } from "../helpers/db";

const ada: Actor = { userId: "ada", email: "ada@gmail.com", role: "editor" };
const grace: Actor = { userId: "grace", email: "grace@gmail.com", role: "editor" };
const vic: Actor = { userId: "vic", email: "vic@gmail.com", role: "viewer" };

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup() {
  const db = await makeTestDb();
  await db.insert(user).values([
    { id: "ada", name: "Ada Lovelace", email: "ada@gmail.com" },
    { id: "grace", name: "Grace Hopper", email: "grace@gmail.com" },
    { id: "vic", name: "Vic", email: "vic@gmail.com" },
  ]);
  const { id } = await createProject(db, ada, { name: "P", format: "short_9x16" });
  // A fresh breaker per test, so one test's error never turns presence off in another.
  const breaker = createPresenceBreaker();
  const check = (actor: Actor, share: Share | null, projectId = id) => checkIn(db, actor, projectId, share, { breaker });
  const leave = (actor: Actor, tabId: string, projectId = id) => leavePresence(db, actor, projectId, tabId, { breaker });
  return { db, id, check, leave };
}

const share = (tabId: string, clipIds: string[] = [], trackId: string | null = null, changedAgoMs = 0): Share => ({
  tabId,
  clipIds,
  trackId,
  changedAgoMs,
});

type Row = {
  clip_ids: string[];
  track_id: string | null;
  xmin: string;
  xmax: string;
  seen_ago: number;
  changed_ago: number;
  left: boolean;
};

async function rowFor(db: DB, userId: string, tabId: string, projectId?: string): Promise<Row | undefined> {
  const rows = rowsOf<Row>(
    await db.execute(sql`
      select clip_ids, track_id, xmin::text as xmin, xmax::text as xmax,
             (extract(epoch from now() - seen_at) * 1000)::integer as seen_ago,
             (extract(epoch from now() - changed_at) * 1000)::integer as changed_ago,
             left_at is not null as left
      from project_presence
      where user_id = ${userId} and tab_id = ${tabId} and (${projectId ?? null}::text is null or project_id = ${projectId ?? null}::text)`),
  );
  return rows[0];
}

async function rowCount(db: DB, where = sql`true`): Promise<number> {
  return rowsOf<{ n: number }>(await db.execute(sql`select count(*)::integer as n from project_presence where ${where}`))[0].n;
}

// Moves rows into the past instead of waiting.
async function backdate(db: DB, ms: number, where = sql`true`) {
  await db.execute(sql`
    update project_presence
    set seen_at = seen_at - ${ms}::integer * interval '1 millisecond',
        changed_at = changed_at - ${ms}::integer * interval '1 millisecond'
    where ${where}`);
}

// Like `db`, but counts execute() calls and fails the first `failures` of them.
function countingDb(db: DB, failures = 0, error: Error = Object.assign(new Error("internal error"), { code: "XX000" })) {
  const executes = vi.fn();
  let left = failures;
  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "execute") return Reflect.get(target, prop, receiver);
      return (query: Parameters<DB["execute"]>[0]) => {
        executes();
        if (left-- > 0) return Promise.reject(error);
        return target.execute(query);
      };
    },
  });
  return { db: wrapped, executes };
}

describe("teammates' selections", () => {
  it("a tab's selection is listed to a teammate under the name from the user table", async () => {
    const { check } = await setup();
    await check(grace, share("grace-tab-1", ["c1", "c2"], "t1"));
    expect(await check(ada, share("ada-tab-1"))).toEqual({
      version: 0,
      peers: [{ userId: "grace", name: "Grace Hopper", clipIds: ["c1", "c2"], trackId: "t1" }],
    });
  });

  it("you never see your own selections, from any tab", async () => {
    const { check } = await setup();
    await check(ada, share("ada-tab-1", ["c1"]));
    await check(ada, share("ada-tab-2", ["c2"]));
    expect(await check(ada, share("ada-tab-1", ["c1"]))).toEqual({ version: 0, peers: [] });
    expect((await check(grace, share("grace-tab-1")))?.peers).toEqual([
      { userId: "ada", name: "Ada Lovelace", clipIds: ["c2"], trackId: null },
    ]);
  });

  it("a teammate with two tabs is listed once, with the selection changed last", async () => {
    const { db, check } = await setup();
    await check(grace, share("grace-tab-a", ["c1"]));
    await backdate(db, 2000);
    await check(grace, share("grace-tab-b", ["c2"]));
    expect((await check(ada, share("ada-tab-1")))?.peers).toEqual([
      { userId: "grace", name: "Grace Hopper", clipIds: ["c2"], trackId: null },
    ]);
    await backdate(db, 2000);
    await check(grace, share("grace-tab-a", ["c3"]));
    expect((await check(ada, share("ada-tab-1")))?.peers).toEqual([
      { userId: "grace", name: "Grace Hopper", clipIds: ["c3"], trackId: null },
    ]);
  });

  it("a row re-inserted with an old changedAgoMs does not outrank the active tab", async () => {
    const { check } = await setup();
    await check(grace, share("grace-tab-a", ["c1"], null, 1000));
    // Back from the back/forward cache: a new row, but a selection made a minute ago on that tab's clock.
    await check(grace, share("grace-tab-b", ["c2"], null, 60_000));
    expect((await check(ada, share("ada-tab-1")))?.peers).toEqual([
      { userId: "grace", name: "Grace Hopper", clipIds: ["c1"], trackId: null },
    ]);
  });

  it("an unchanged recent selection writes nothing: xmin and xmax of the row stay the same", async () => {
    const { db, check } = await setup();
    await check(ada, share("ada-tab-1", ["c1"], "t1"));
    await backdate(db, 5000);
    const before = await rowFor(db, "ada", "ada-tab-1");
    await check(ada, share("ada-tab-1", ["c1"], "t1"));
    const after = await rowFor(db, "ada", "ada-tab-1");
    expect(after).toMatchObject({ xmin: before!.xmin, xmax: before!.xmax });
    expect(after!.seen_ago).toBeGreaterThanOrEqual(5000);
  });

  it("an unchanged selection backdated past the refresh time is written again", async () => {
    const { db, check } = await setup();
    await check(ada, share("ada-tab-1", ["c1"]));
    await backdate(db, LIMITS.presenceRefreshMs + 1000);
    const before = await rowFor(db, "ada", "ada-tab-1");
    await check(ada, share("ada-tab-1", ["c1"]));
    const after = await rowFor(db, "ada", "ada-tab-1");
    expect(after!.xmin).not.toBe(before!.xmin);
    expect(after!.seen_ago).toBeLessThan(1000);
    expect(after!.changed_ago).toBeGreaterThanOrEqual(LIMITS.presenceRefreshMs); // the selection did not change
  });

  it("a changed selection is written at once and changed_at moves", async () => {
    const { db, check } = await setup();
    await check(ada, share("ada-tab-1", ["c1"]));
    await backdate(db, 5000);
    await check(ada, share("ada-tab-1", ["c2"], "t2"));
    expect(await rowFor(db, "ada", "ada-tab-1")).toMatchObject({ clip_ids: ["c2"], track_id: "t2", left: false });
    const row = await rowFor(db, "ada", "ada-tab-1");
    expect(row!.seen_ago).toBeLessThan(1000);
    expect(row!.changed_ago).toBeLessThan(1000);
  });

  it("a tab not heard from for the TTL is not listed", async () => {
    const { db, check } = await setup();
    await check(grace, share("grace-tab-1", ["c1"]));
    await backdate(db, LIMITS.presenceTtlMs - 2000);
    expect((await check(ada, share("ada-tab-1")))?.peers).toHaveLength(1);
    await backdate(db, 3000, sql`user_id = 'grace'`);
    expect((await check(ada, share("ada-tab-1")))?.peers).toEqual([]);
  });

  it("an empty selection is listed as here with nothing selected", async () => {
    const { check } = await setup();
    await check(grace, share("grace-tab-1"));
    expect((await check(ada, share("ada-tab-1")))?.peers).toEqual([
      { userId: "grace", name: "Grace Hopper", clipIds: [], trackId: null },
    ]);
  });

  it("leaving marks the row as left; a later check from that tab writes nothing and is not listed", async () => {
    const { db, check, leave } = await setup();
    await check(grace, share("grace-tab-1", ["c1"]));
    await leave(grace, "grace-tab-1");
    const left = await rowFor(db, "grace", "grace-tab-1");
    expect(left).toMatchObject({ left: true, clip_ids: ["c1"] });
    expect(await check(grace, share("grace-tab-1", ["c2"]))).toEqual({ version: 0, peers: [] });
    expect(await rowFor(db, "grace", "grace-tab-1")).toMatchObject({ xmin: left!.xmin, clip_ids: ["c1"], left: true });
    expect((await check(ada, share("ada-tab-1")))?.peers).toEqual([]);
  });

  it("leaving before the tab's first share still blocks that share", async () => {
    const { db, check, leave } = await setup();
    await leave(grace, "grace-tab-1");
    await check(grace, share("grace-tab-1", ["c1"]));
    expect(await rowFor(db, "grace", "grace-tab-1")).toMatchObject({ left: true, clip_ids: [] });
    expect((await check(ada, share("ada-tab-1")))?.peers).toEqual([]);
  });

  it("a person keeps at most presenceTabsPerPerson rows per project, and their rows older than the TTL go", async () => {
    const { db, id, check } = await setup();
    const { id: other } = await createProject(db, ada, { name: "Other", format: "short_9x16" });
    await check(ada, share("ada-other-tab"), other);
    for (let i = 1; i <= LIMITS.presenceTabsPerPerson + 2; i++) {
      await backdate(db, 1000); // each earlier tab was last heard from before this one
      await check(ada, share(`ada-tab-${i}`, [`c${i}`]));
    }
    const tabs = async () =>
      rowsOf<{ tab_id: string }>(
        await db.execute(sql`select tab_id from project_presence where project_id = ${id} and user_id = 'ada' order by tab_id`),
      ).map((r) => r.tab_id);
    expect(await tabs()).toEqual(["ada-tab-3", "ada-tab-4", "ada-tab-5", "ada-tab-6", "ada-tab-7"]);
    expect(await rowFor(db, "ada", "ada-other-tab", other)).toBeDefined(); // another project's rows are not counted

    await backdate(db, LIMITS.presenceTtlMs, sql`tab_id = 'ada-tab-3'`);
    await check(ada, share("ada-tab-7", ["c7"]));
    expect(await tabs()).toEqual(["ada-tab-4", "ada-tab-5", "ada-tab-6", "ada-tab-7"]);
  });

  it("rows older than the keep time are deleted by anyone's check in any project, never the caller's own rows", async () => {
    const { db, id, check } = await setup();
    const { id: other } = await createProject(db, ada, { name: "Other", format: "short_9x16" });
    await check(ada, share("ada-tab-1", ["c1"]));
    await db.execute(sql`
      insert into project_presence (project_id, user_id, tab_id, clip_ids)
      select ${other}, 'grace', 'grace-tab-' || n, '[]'::jsonb from generate_series(1, ${LIMITS.presenceSweepRows + 10}) n`);
    await backdate(db, LIMITS.presenceKeepMs + 1000);
    await check(ada, share("ada-tab-1", ["c1"]));
    // At most presenceSweepRows go per check.
    expect(await rowCount(db, sql`user_id = 'grace'`)).toBe(10);
    // The caller's own old row in this project is refreshed, not swept.
    const mine = await rowFor(db, "ada", "ada-tab-1", id);
    expect(mine).toMatchObject({ clip_ids: ["c1"], left: false });
    expect(mine!.seen_ago).toBeLessThan(1000);
    await check(vic, share("vic-tab-1"));
    expect(await rowCount(db, sql`user_id = 'grace'`)).toBe(0);
  });

  it("a deleted or unknown project writes nothing and answers null", async () => {
    const { db, id, check, leave } = await setup();
    await deleteProject(db, ada, id);
    expect(await check(ada, share("ada-tab-1", ["c1"]))).toBeNull();
    expect(await check(ada, share("ada-tab-1", ["c1"]), "nope")).toBeNull();
    expect(await check(ada, null)).toBeNull();
    await leave(ada, "ada-tab-1");
    await leave(ada, "ada-tab-1", "nope");
    expect(await rowCount(db)).toBe(0);
  });

  it("a viewer may share and is listed", async () => {
    const { check, leave } = await setup();
    expect(await check(vic, share("vic-tab-1", ["c1"]))).toEqual({ version: 0, peers: [] });
    expect((await check(ada, share("ada-tab-1")))?.peers).toEqual([{ userId: "vic", name: "Vic", clipIds: ["c1"], trackId: null }]);
    await leave(vic, "vic-tab-1");
    expect((await check(ada, share("ada-tab-1")))?.peers).toEqual([]);
  });

  it("another person using the same tab id never touches your row", async () => {
    const { db, check, leave } = await setup();
    await check(ada, share("same-tab-id", ["c1"]));
    const before = await rowFor(db, "ada", "same-tab-id");
    await check(grace, share("same-tab-id", ["c2"]));
    await leave(grace, "same-tab-id");
    expect(await rowFor(db, "ada", "same-tab-id")).toMatchObject({ xmin: before!.xmin, clip_ids: ["c1"], left: false });
    expect(await rowFor(db, "grace", "same-tab-id")).toMatchObject({ clip_ids: ["c2"], left: true });
  });

  it("at most presencePeers people are listed", async () => {
    const { db, check } = await setup();
    const count = LIMITS.presencePeers + 3;
    const ids = Array.from({ length: count }, (_, i) => `p${String(i).padStart(2, "0")}`);
    await db.insert(user).values(ids.map((id) => ({ id, name: `Person ${id}`, email: `${id}@gmail.com` })));
    for (const userId of ids) await check({ userId, email: `${userId}@gmail.com`, role: "editor" }, share(`${userId}-tab-1`));
    // The first three by id changed their selection longest ago, so they are the ones left out.
    await db.execute(sql`update project_presence set changed_at = now() - interval '5 minutes' where user_id in ('p00', 'p01', 'p02')`);
    const peers = (await check(ada, share("ada-tab-1")))?.peers ?? [];
    expect(peers).toHaveLength(LIMITS.presencePeers);
    expect(peers.map((p) => p.name)).toEqual([...peers.map((p) => p.name)].sort());
    expect(peers.map((p) => p.userId)).not.toContain("p00");
    expect(peers.map((p) => p.userId)).toContain(ids[count - 1]);
  });

  it("the answer's version is the project's version", async () => {
    const { db, id, check } = await setup();
    await db.execute(sql`update projects set version = 7 where id = ${id}`);
    expect(await check(ada, share("ada-tab-1"))).toEqual({ version: 7, peers: [] });
    expect(await check(ada, null)).toEqual({ version: 7 });
  });

  it("without the presence table the version is still answered, with no peers, and the breaker stays open for five minutes", async () => {
    const { db, id } = await setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 1_000_000;
    const breaker = createPresenceBreaker(() => now);
    const check = () => checkIn(db, ada, id, share("ada-tab-1", ["c1"]), { breaker });
    await db.execute(sql`alter table project_presence rename to project_presence_away`);
    expect(await check()).toEqual({ version: 0 });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(
      "The project_presence table is missing: run pnpm db:migrate. Teammates' selections are off until it exists.",
    );
    await db.execute(sql`alter table project_presence_away rename to project_presence`);
    now += 5 * 60_000 - 1;
    expect(await check()).toEqual({ version: 0 });
    expect(await rowCount(db)).toBe(0);
    now += 1;
    expect(await check()).toEqual({ version: 0, peers: [] });
    expect(await rowCount(db)).toBe(1);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("after any other error the breaker skips the statement for a minute and logs once", async () => {
    const { db: real, id } = await setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 1_000_000;
    const breaker = createPresenceBreaker(() => now);
    const { db, executes } = countingDb(real, 1);
    const check = () => checkIn(db, ada, id, share("ada-tab-1", ["c1"]), { breaker });
    expect(await check()).toEqual({ version: 0 });
    expect(executes).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]).toContain("XX000");

    now += 60_000 - 1;
    expect(await check()).toEqual({ version: 0 });
    await leavePresence(db, ada, id, "ada-tab-1", { breaker });
    expect(executes).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);

    now += 1;
    expect(await check()).toEqual({ version: 0, peers: [] });
    expect(executes).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("a deadlock or serialization failure answers that one check plainly and leaves the breaker shut", async () => {
    const { db: real, id } = await setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const breaker = createPresenceBreaker(() => 0);
    for (const code of ["40P01", "40001"]) {
      const { db } = countingDb(real, 1, Object.assign(new Error("try again"), { code }));
      expect(await checkIn(db, ada, id, share("ada-tab-1", ["c1"]), { breaker })).toEqual({ version: 0 });
      expect(breaker.isOpen()).toBe(false);
      expect(await checkIn(db, ada, id, share("ada-tab-1", ["c1"]), { breaker })).toEqual({ version: 0, peers: [] });
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it("two of one person's tabs both past the TTL can check at once without a deadlock", async () => {
    const { db, id, check } = await setup();
    await check(ada, share("ada-tab-1", ["c1"]));
    await check(ada, share("ada-tab-2", ["c2"]));
    await db.execute(sql`update project_presence set seen_at = now() - interval '2 minutes'`);
    const breaker = createPresenceBreaker(() => 0);
    const answers = await Promise.all([
      checkIn(db, ada, id, share("ada-tab-1", ["c1"]), { breaker }),
      checkIn(db, ada, id, share("ada-tab-2", ["c2"]), { breaker }),
    ]);
    expect(answers).toEqual([{ version: 0, peers: [] }, { version: 0, peers: [] }]);
    expect(breaker.isOpen()).toBe(false);
  });

  it("a failing leave is swallowed and opens the breaker", async () => {
    const { db: real, id } = await setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const breaker = createPresenceBreaker(() => 0);
    const { db } = countingDb(real, 1);
    await expect(leavePresence(db, ada, id, "ada-tab-1", { breaker })).resolves.toBeUndefined();
    expect(breaker.isOpen()).toBe(true);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("without a share only the version is read", async () => {
    const { db: real, id } = await setup();
    const { db, executes } = countingDb(real);
    expect(await checkIn(db, ada, id, null, { breaker: createPresenceBreaker() })).toEqual({ version: 0 });
    expect(executes).not.toHaveBeenCalled();
    expect(await rowCount(real)).toBe(0);
  });
});
