import { describe, expect, it, vi } from "vitest";
import { checkDatabaseSize, DB_SIZE_THRESHOLDS, neonStorage, type Push, sendPush, type Storage } from "@/lib/db-size-alert";

const MB = 1024 * 1024;

const storage = (production: number, dev = 32 * MB, other = 34 * MB): Storage => ({
  totalBytes: production + dev + other,
  branches: [
    { name: "dev", bytes: dev },
    { name: "production", bytes: production },
    { name: "verify-4a", bytes: other },
  ],
});

function run(s: Storage, opts: { test?: boolean } = {}) {
  const push = vi.fn<(note: Push) => Promise<void>>(async () => {});
  return checkDatabaseSize({ measure: async () => s, push, test: opts.test }).then((result) => ({ result, push }));
}

describe("checking the database storage", () => {
  it("under the first threshold, counting every branch: no push", async () => {
    const { result, push } = await run(storage(34 * MB));
    expect(result).toEqual({ bytes: 100 * MB, level: "ok", pushed: false });
    expect(push).not.toHaveBeenCalled();
  });

  it("past 500 MB in total: a normal push naming the biggest branches and what happens at 1 GB", async () => {
    const { result, push } = await run(storage(DB_SIZE_THRESHOLDS.warnBytes - 66 * MB));
    expect(result.level).toBe("warn");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0]).toEqual({
      title: "EasyEdit database at 500 MB",
      message:
        "EasyEdit's database storage is 500 MB of the Free plan's 1 GB, all branches together (biggest: production 434 MB, verify-4a 34 MB). At 1 GB, saving stops for everyone until space is freed or the plan is upgraded.",
      priority: "default",
    });
  });

  it("past 800 MB: an urgent push", async () => {
    const { result, push } = await run(storage(800 * MB));
    expect(result.level).toBe("urgent");
    expect(push.mock.calls[0]![0]).toMatchObject({ priority: "urgent", title: "EasyEdit database at 866 MB" });
  });

  it("a test run always pushes, saying it's a test", async () => {
    const { result, push } = await run(storage(34 * MB), { test: true });
    expect(result.pushed).toBe(true);
    expect(push.mock.calls[0]![0]).toEqual({
      title: "EasyEdit size alert: test",
      message:
        "EasyEdit's database storage is 100 MB of the Free plan's 1 GB, all branches together (biggest: production 34 MB, verify-4a 34 MB). Alerts come at 500 MB and 800 MB.",
      priority: "default",
    });
  });
});

describe("reading Neon's storage", () => {
  const answering = (status: number, body: unknown) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

  it("sums the logical size of every branch, with the project key", async () => {
    const fetchFn = answering(200, { branches: [{ name: "production", logical_size: 35_000_000 }, { name: "dev", logical_size: "34000000" }] });
    expect(await neonStorage("key-1", "proj-1", fetchFn)).toEqual({
      totalBytes: 69_000_000,
      branches: [{ name: "production", bytes: 35_000_000 }, { name: "dev", bytes: 34_000_000 }],
    });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("https://console.neon.tech/api/v2/projects/proj-1/branches");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer key-1");
  });

  it("a broken answer is an error, never read as 0", async () => {
    await expect(neonStorage("k", "p", answering(401, {}))).rejects.toThrow("Neon answered 401");
    await expect(neonStorage("k", "p", answering(200, { branches: [] }))).rejects.toThrow("no branches");
    await expect(neonStorage("k", "p", answering(200, { branches: [{ name: "production" }] }))).rejects.toThrow("without a size");
  });
});

describe("sending a phone push", () => {
  it("posts to the ntfy topic with a title and priority", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await sendPush("easyedit-topic-abc", { title: "T", message: "M", priority: "urgent" }, fetchFn);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("https://ntfy.sh/easyedit-topic-abc");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("M");
    expect(new Headers(init?.headers).get("Title")).toBe("T");
    expect(new Headers(init?.headers).get("Priority")).toBe("urgent");
  });

  it("an error answer from ntfy is thrown, so the cron run shows as failed", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("nope", { status: 500 }));
    await expect(sendPush("t", { title: "T", message: "M", priority: "default" }, fetchFn)).rejects.toThrow("ntfy answered 500");
  });
});
