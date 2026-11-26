import { describe, expect, it, vi } from "vitest";
import { makeStyleTrimCron } from "@/lib/style/trim-cron";

function cron(env: Record<string, string | undefined>) {
  const trim = vi.fn(async () => 3);
  return { handler: makeStyleTrimCron({ env, trim }), trim };
}

const get = (auth?: string) => new Request("http://localhost/api/cron/style-trim", { headers: auth === undefined ? {} : { authorization: auth } });

describe("the daily clean-up of what styles kept from YouTube", () => {
  it("refuses a request without the cron secret, before cutting anything back", async () => {
    const { handler, trim } = cron({ CRON_SECRET: "s3cret" });
    for (const auth of [undefined, "Bearer wrong", "s3cret"]) {
      expect((await handler(get(auth))).status, String(auth)).toBe(401);
    }
    expect(trim).not.toHaveBeenCalled();
  });

  it("refuses everything when no cron secret is set on the server", async () => {
    const { handler, trim } = cron({});
    expect((await handler(get("Bearer "))).status).toBe(401);
    expect((await handler(get("Bearer undefined"))).status).toBe(401);
    expect(trim).not.toHaveBeenCalled();
  });

  it("with the secret: cuts back and answers how many", async () => {
    const { handler, trim } = cron({ CRON_SECRET: "s3cret" });
    const res = await handler(get("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trimmed: 3 });
    expect(trim).toHaveBeenCalledOnce();
  });
});
