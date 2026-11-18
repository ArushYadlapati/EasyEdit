import { describe, expect, it } from "vitest";
import { SOCIAL_MESSAGES } from "@/lib/social/messages";
import { createPosting } from "@/lib/social/post-client";
import type { PostForm } from "@/lib/social/rules";

const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=s1";
const form: PostForm = { title: "Match recap", description: "", visibility: "private", madeForKids: false };

const isFailed = (body: unknown) => typeof body === "object" && body !== null && "failed" in body;

type Sent = { url: string; method: string; body: unknown; range: string | null; keepalive: boolean };

// A pretend server and YouTube. `api` answers our own routes by their last path part; `youtube` answers each piece.
function world(over: { api?: Partial<Record<string, (sent: Sent) => Response | Promise<Response>>>; youtube?: (sent: Sent) => Response } = {}) {
  const sent: Sent[] = [];
  let received = 0;
  const api: Record<string, (sent: Sent) => Response | Promise<Response>> = {
    posts: () => Response.json({ id: "sp_1", uploadUrl: UPLOAD }, { status: 201 }),
    offset: () => Response.json({ offset: received, done: false }),
    finish: () => Response.json({ videoId: "video000001", url: "https://youtu.be/video000001" }),
    cancel: (sent) => Response.json({ status: isFailed(sent.body) ? "failed" : "canceled", url: null }),
    status: () => Response.json({ available: true, channel: "Seattle Solvers", broken: false, canConnect: true, settingsPath: "/s/x/settings/socials" }),
    ...over.api,
  };
  const youtube =
    over.youtube ??
    ((piece: Sent) => {
      const [, end, total] = /bytes \d+-(\d+)\/(\d+)/.exec(piece.range ?? "") ?? [];
      received = Number(end) + 1;
      return received >= Number(total) ? Response.json({ id: "video000001" }, { status: 201 }) : new Response(null, { status: 308, headers: { range: `bytes=0-${received - 1}` } });
    });
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body;
    const record: Sent = {
      url,
      method: init?.method ?? "GET",
      body: typeof body === "string" ? JSON.parse(body) : body instanceof Blob ? body.size : null,
      range: new Headers(init?.headers).get("content-range"),
      keepalive: init?.keepalive === true,
    };
    sent.push(record);
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (url === UPLOAD) return youtube(record);
    const step = new URL(url, "https://app.test").pathname.split("/").pop() ?? "";
    return api[step](record);
  }) as typeof fetch;
  const sleeps: number[] = [];
  const posting = createPosting({ fetch: fetchFn, chunkBytes: 4, sleep: async (ms) => void sleeps.push(ms) });
  const progress: number[] = [];
  const post = (signal: AbortSignal = new AbortController().signal, file: Blob = new Blob(["0123456789"])) =>
    posting.post({ projectId: "p1", form, file, signal, onProgress: (bytes) => progress.push(bytes) });
  const steps = () => sent.map((s) => (s.url === UPLOAD ? `PUT ${s.range}` : new URL(s.url, "https://app.test").pathname.replace("/api/social/youtube/", "")));
  return { posting, post, sent, steps, progress, sleeps };
}

describe("posting from the browser", () => {
  it("opens the post, sends the file in pieces straight to YouTube, then records it", async () => {
    const { post, sent, steps, progress } = world();
    expect(await post()).toEqual({ status: "posted", url: "https://youtu.be/video000001" });
    expect(steps()).toEqual(["posts", "PUT bytes 0-3/10", "PUT bytes 4-7/10", "PUT bytes 8-9/10", "posts/sp_1/finish"]);
    expect(sent[0].body).toEqual({ projectId: "p1", title: "Match recap", description: "", visibility: "private", madeForKids: false, sizeBytes: 10 });
    expect(sent.at(-1)?.body).toEqual({ videoId: "video000001" }); // read from YouTube's answer to the last piece
    expect(progress).toEqual([4, 8, 10]);
  });

  it("says why the server would not start the post", async () => {
    const { post, steps } = world({ api: { posts: () => Response.json({ code: "LIMIT_EXCEEDED", message: SOCIAL_MESSAGES.dayUsedUp }, { status: 429 }) } });
    expect(await post()).toEqual({ status: "failed", message: SOCIAL_MESSAGES.dayUsedUp });
    expect(steps()).toEqual(["posts"]);
  });

  it("picks up where YouTube is after a piece fails", async () => {
    let failures = 1;
    const { post, steps, sleeps } = world({
      youtube: (piece) => {
        if (piece.range === "bytes 4-7/10" && failures-- > 0) return new Response(null, { status: 503 });
        const end = Number(/-(\d+)\//.exec(piece.range ?? "")?.[1]);
        return end + 1 >= 10 ? Response.json({ id: "video000001" }, { status: 201 }) : new Response(null, { status: 308, headers: { range: `bytes=0-${end}` } });
      },
      api: { offset: () => Response.json({ offset: 4, done: false }) },
    });
    expect(await post()).toEqual({ status: "posted", url: "https://youtu.be/video000001" });
    expect(steps()).toEqual(["posts", "PUT bytes 0-3/10", "PUT bytes 4-7/10", "posts/sp_1/offset", "PUT bytes 4-7/10", "PUT bytes 8-9/10", "posts/sp_1/finish"]);
    expect(sleeps).toEqual([1000]);
  });

  it("stops at once, with the server's words, when the server says the upload is over", async () => {
    const { post, steps } = world({
      youtube: () => new Response(null, { status: 503 }),
      api: { offset: () => Response.json({ code: "EXPIRED", message: SOCIAL_MESSAGES.expired }, { status: 410 }) },
    });
    expect(await post()).toEqual({ status: "failed", message: SOCIAL_MESSAGES.expired });
    expect(steps()).toEqual(["posts", "PUT bytes 0-3/10", "posts/sp_1/offset"]);
  });

  it("gives up after YouTube keeps failing, and tells the server the post failed", async () => {
    const { post, sent, sleeps } = world({ youtube: () => new Response(null, { status: 503 }), api: { offset: () => Response.json({ offset: 0, done: false }) } });
    expect(await post()).toEqual({ status: "failed", message: SOCIAL_MESSAGES.uploadStopped });
    expect(sleeps).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(sent.at(-1)).toMatchObject({ body: { failed: true }, keepalive: true });
    expect(sent.at(-1)?.url).toBe("/api/social/youtube/posts/sp_1/cancel");
  });

  it("a session YouTube closed reads as an upload that took too long", async () => {
    const { post, sent } = world({ youtube: () => new Response(null, { status: 404 }) });
    expect(await post()).toEqual({ status: "failed", message: SOCIAL_MESSAGES.expired });
    expect(sent.at(-1)?.body).toEqual({ failed: true });
  });

  it("Cancel stops the upload and tells the server, as a cancel", async () => {
    const controller = new AbortController();
    const { post, sent } = world({
      youtube: (piece) => {
        controller.abort();
        return new Response(null, { status: 308, headers: { range: `bytes=0-${Number(/-(\d+)\//.exec(piece.range ?? "")?.[1])}` } });
      },
    });
    expect(await post(controller.signal)).toEqual({ status: "canceled" });
    expect(sent.at(-1)).toMatchObject({ url: "/api/social/youtube/posts/sp_1/cancel", body: {}, keepalive: true });
    expect(sent.filter((s) => s.url === UPLOAD)).toHaveLength(1);
  });

  it("tries again to record a post the server did not answer for", async () => {
    let tries = 0;
    const flaky = world({ api: { finish: () => (++tries < 3 ? new Response(null, { status: 502 }) : Response.json({ videoId: null, url: null })) } });
    expect(await flaky.post()).toEqual({ status: "posted", url: null });
    expect(flaky.sleeps).toEqual([1000, 2000]);
  });

  it("a video that is at YouTube is never called a failure to post again: with its id, it is posted", async () => {
    const down = world({ api: { finish: () => Response.json({ code: "PLATFORM_REFUSED", message: SOCIAL_MESSAGES.unreachable }, { status: 502 }) } });
    expect(await down.post()).toEqual({ status: "posted", url: "https://youtu.be/video000001" });
    expect(down.sleeps).toEqual([1000, 2000, 4000, 8000]);

    // Without an id (YouTube's last answer could not be read), it says to look on the channel first.
    const blind = world({
      youtube: (piece) => {
        const end = Number(/-(\d+)\//.exec(piece.range ?? "")?.[1]);
        return end + 1 >= 10 ? new Response(null, { status: 200 }) : new Response(null, { status: 308, headers: { range: `bytes=0-${end}` } });
      },
      api: { finish: () => Promise.reject(new Error("offline")) },
    });
    expect(await blind.post()).toEqual({ status: "failed", message: SOCIAL_MESSAGES.unconfirmed });
  });

  it("says the server's reason when it refuses to record the post", async () => {
    const refused = world({ api: { finish: () => Response.json({ code: "CONFLICT", message: SOCIAL_MESSAGES.notFinished }, { status: 409 }) } });
    expect(await refused.post()).toEqual({ status: "failed", message: SOCIAL_MESSAGES.notFinished });
    expect(refused.sleeps).toEqual([]);
  });

  it("Cancel while the post is being opened waits for the server's answer, then ends that post", async () => {
    const controller = new AbortController();
    const { post, steps, sent } = world({
      api: {
        posts: () => {
          controller.abort(); // pressed while the request is on its way
          return Response.json({ id: "sp_1", uploadUrl: UPLOAD }, { status: 201 });
        },
      },
    });
    expect(await post(controller.signal)).toEqual({ status: "canceled" });
    expect(steps()).toEqual(["posts", "posts/sp_1/cancel"]);
    expect(sent[0].url).toBe("/api/social/youtube/posts");
  });

  it("a stop the server answers with posted is a posted video", async () => {
    const { post } = world({
      youtube: () => new Response(null, { status: 503 }),
      api: { offset: () => Response.json({ offset: 0, done: false }), cancel: () => Response.json({ status: "posted", url: "https://youtu.be/video000001" }) },
    });
    expect(await post()).toEqual({ status: "posted", url: "https://youtu.be/video000001" });
  });
});

describe("posting status", () => {
  it("is what the server says, and no posting when it can't be asked or says something else", async () => {
    expect(await world().posting.status("p 1")).toEqual({ available: true, channel: "Seattle Solvers", broken: false, canConnect: true, settingsPath: "/s/x/settings/socials" });
    expect(await world({ api: { status: () => new Response(null, { status: 401 }) } }).posting.status("p1")).toEqual({ available: false });
    expect(await world({ api: { status: () => Response.json({ available: true }) } }).posting.status("p1")).toEqual({ available: false });
    expect(await world({ api: { status: () => Promise.reject(new Error("offline")) } }).posting.status("p1")).toEqual({ available: false });
    const asked = world();
    await asked.posting.status("p 1");
    expect(asked.sent[0].url).toBe("/api/social/youtube/status?project=p%201");
  });
});
