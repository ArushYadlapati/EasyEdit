import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { CurrentUser } from "@/lib/access-rules";
import { makeMediaHandlers } from "@/lib/media/handlers";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { VIDEO, mediaContext } from "./context";

const MESSAGE = "You've reached today's limit for uploads (500). It frees up over the next 24 hours.";

describe("upload limit", () => {
  it("opening a new upload answers 429 at 500 a day; another person can still upload", async () => {
    const ctx = await mediaContext();
    const handlers = (who: typeof ctx.ada) => {
      const auth = async (): Promise<CurrentUser> => ({ id: who.userId, email: who.email, name: who.email, image: null, allowlistRole: who.role });
      return makeMediaHandlers({ db: () => ctx.db, auth, drive: async () => ctx.deps.drive, reader: async () => null, origin: () => "https://app.test" });
    };
    const open = (api: ReturnType<typeof handlers>) =>
      api.open(new Request(`https://app.test/api/media?space=${SEED_TEAM_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.test" },
        body: JSON.stringify(VIDEO),
      }));
    await ctx.db.execute(sql`insert into assets (id, space_id, kind, name, file_name, mime_type, size_bytes, last_modified_ms, uploaded_by)
      select 'seed' || g, ${SEED_TEAM_ID}, 'video', 'v', 'v' || g || '.mp4', 'video/mp4', 1, 1, ${ctx.ada.userId} from generate_series(1, 500) g`);
    const refused = await open(handlers(ctx.ada));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ code: "LIMIT_EXCEEDED", message: MESSAGE });
    expect((await open(handlers(ctx.grace))).status).toBe(201);
  });
});
