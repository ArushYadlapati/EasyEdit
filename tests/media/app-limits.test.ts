import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { CurrentUser } from "@/lib/access-rules";
import { makeMediaHandlers } from "@/lib/media/handlers";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { VIDEO, mediaContext } from "./context";

const MESSAGE = "You've reached today's limit for uploads (500). It frees up over the next 24 hours.";

const handlers = (ctx: Awaited<ReturnType<typeof mediaContext>>, who: Awaited<ReturnType<typeof mediaContext>>["ada"]) => {
  const auth = async (): Promise<CurrentUser> => ({ id: who.userId, email: who.email, name: who.email, image: null, allowlistRole: who.role });
  return makeMediaHandlers({ db: () => ctx.db, auth, drive: async () => ctx.deps.drive, reader: async () => null, origin: () => "https://app.test" });
};
const openRequest = (body: unknown) =>
  new Request(`https://app.test/api/media?space=${SEED_TEAM_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.test" },
    body: JSON.stringify(body),
  });

describe("upload limit", () => {
  it("opening a new upload answers 429 at 500 a day; another person can still upload", async () => {
    const ctx = await mediaContext();
    const open = (api: ReturnType<typeof handlers>) => api.open(openRequest(VIDEO));
    await ctx.db.execute(sql`insert into assets (id, space_id, kind, name, file_name, mime_type, size_bytes, last_modified_ms, uploaded_by)
      select 'seed' || g, ${SEED_TEAM_ID}, 'video', 'v', 'v' || g || '.mp4', 'video/mp4', 1, 1, ${ctx.ada.userId} from generate_series(1, 500) g`);
    await ctx.db.execute(sql`update assets set status = 'ready', ready_at = now() where id like 'seed%'`);
    const refused = await open(handlers(ctx, ctx.ada));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ code: "LIMIT_EXCEEDED", message: MESSAGE });
    expect((await open(handlers(ctx, ctx.grace))).status).toBe(201);
  });

  it("at 500 a day, an unfinished upload of the same file still resumes; a new file is refused", async () => {
    const ctx = await mediaContext();
    const api = handlers(ctx, ctx.ada);
    const first = await api.open(openRequest(VIDEO));
    expect(first.status).toBe(201);
    await ctx.db.execute(sql`insert into assets (id, space_id, kind, name, file_name, mime_type, size_bytes, last_modified_ms, uploaded_by, status)
      select 'seed' || g, ${SEED_TEAM_ID}, 'video', 'v', 'v' || g || '.mp4', 'video/mp4', 1, 1, ${ctx.ada.userId}, 'ready' from generate_series(1, 499) g`);
    expect((await api.open(openRequest(VIDEO))).status).toBe(201);
    const other = await api.open(openRequest({ ...VIDEO, fileName: "other.MOV", lastModifiedMs: VIDEO.lastModifiedMs + 1 }));
    expect(other.status).toBe(429);
    expect(await other.json()).toEqual({ code: "LIMIT_EXCEEDED", message: MESSAGE });
  });
});
