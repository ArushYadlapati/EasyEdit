import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDbSizeCron, type Push, type Storage } from "@/lib/db-size-alert";

const MB = 1024 * 1024;
const ALL = { CRON_SECRET: "s3cret", NTFY_TOPIC: "t", NEON_API_KEY: "k", NEON_PROJECT_ID: "p" };

function cron(env: Record<string, string | undefined>, totalBytes = 100 * MB) {
  const push = vi.fn<(topic: string, note: Push) => Promise<void>>(async () => {});
  const measure = vi.fn<(apiKey: string, projectId: string) => Promise<Storage>>(async () => ({ totalBytes, branches: [{ name: "production", bytes: totalBytes }] }));
  const handler = makeDbSizeCron({ env, measure, push });
  return { handler, push, measure };
}

const get = (query = "", auth?: string) =>
  new Request(`http://localhost/api/cron/db-size${query}`, { headers: auth === undefined ? {} : { authorization: auth } });

afterEach(() => vi.restoreAllMocks());

describe("the daily size check route", () => {
  it("refuses a request without the cron secret, before measuring anything", async () => {
    const { handler, push, measure } = cron(ALL);
    for (const auth of [undefined, "Bearer wrong", "s3cret"]) {
      expect((await handler(get("", auth))).status, String(auth)).toBe(401);
    }
    expect(measure).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("refuses everything when no cron secret is set on the server", async () => {
    const { handler } = cron({ ...ALL, CRON_SECRET: undefined });
    expect((await handler(get("", "Bearer "))).status).toBe(401);
    expect((await handler(get("", "Bearer undefined"))).status).toBe(401);
  });

  it("with the secret: measures with the project key and answers what it found", async () => {
    const { handler, push, measure } = cron(ALL, 600 * MB);
    const res = await handler(get("", "Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bytes: 600 * MB, level: "warn", pushed: true });
    expect(measure).toHaveBeenCalledWith("k", "p");
    expect(push.mock.calls[0]![0]).toBe("t");
  });

  it("?test=1 sends a test push", async () => {
    const { handler, push } = cron(ALL);
    expect((await (await handler(get("?test=1", "Bearer s3cret"))).json()).pushed).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("a missing setting fails the run and names it, without measuring", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, push, measure } = cron({ CRON_SECRET: "s3cret", NTFY_TOPIC: "t" });
    const res = await handler(get("", "Bearer s3cret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Not set: NEON_API_KEY, NEON_PROJECT_ID." });
    expect(measure).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(quiet).toHaveBeenCalledTimes(1);
  });
});
