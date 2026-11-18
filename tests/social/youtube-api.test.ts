import { describe, expect, it } from "vitest";
import { DriveError } from "@/lib/drive/token";
import { cancelUpload, isUploadAddress, myChannel, openVideoUpload, uploadState } from "@/lib/social/youtube-api";

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null };

// A pretend Google that answers each request with the next of `answers` and keeps what it was asked.
function google(...answers: Response[]) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => (headers[name] = value));
    calls.push({ url: String(input), method: init?.method ?? "GET", headers, body: typeof init?.body === "string" ? init.body : null });
    const next = answers.shift();
    if (!next) throw new Error("no answer left");
    return next;
  }) as typeof fetch;
  return { fetchFn, calls };
}

const refusal = (status: number, reason: string) => Response.json({ error: { code: status, errors: [{ reason }] } }, { status });
const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc";
const upload = { title: "Match recap", description: "Qualifier 2", visibility: "unlisted" as const, madeForKids: false, sizeBytes: 1234, origin: "https://app.test" };

describe("myChannel", () => {
  it("names the channel the token speaks for", async () => {
    const { fetchFn, calls } = google(Response.json({ items: [{ id: "UC123", snippet: { title: "Seattle Solvers" } }] }));
    expect(await myChannel("tok", fetchFn)).toEqual({ id: "UC123", title: "Seattle Solvers" });
    expect(calls[0].url).toBe("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=1");
    expect(calls[0].headers.authorization).toBe("Bearer tok");
  });

  it("is null for an account with no channel", async () => {
    expect(await myChannel("tok", google(Response.json({ items: [] })).fetchFn)).toBeNull();
    expect(await myChannel("tok", google(Response.json({})).fetchFn)).toBeNull();
  });

  it("turns a refusal into the call, the status and Google's short code", async () => {
    const failure = await myChannel("tok", google(refusal(403, "insufficientPermissions")).fetchFn).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DriveError);
    expect(failure).toMatchObject({ call: "youtube_channel", status: 403, reason: "insufficientPermissions" });
  });
});

describe("openVideoUpload", () => {
  it("opens a resumable upload with the video's facts fixed and the page's origin, and returns its address", async () => {
    const { fetchFn, calls } = google(new Response(null, { status: 200, headers: { location: SESSION } }));
    expect(await openVideoUpload("tok", upload, fetchFn)).toBe(SESSION);
    const [call] = calls;
    expect(call.url).toBe("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status");
    expect(call.method).toBe("POST");
    expect(call.headers).toMatchObject({ authorization: "Bearer tok", origin: "https://app.test", "x-upload-content-type": "video/mp4", "x-upload-content-length": "1234" });
    expect(JSON.parse(call.body ?? "")).toEqual({
      snippet: { title: "Match recap", description: "Qualifier 2" },
      status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    });
  });

  it("keeps YouTube's reason when it refuses", async () => {
    const failure = await openVideoUpload("tok", upload, google(refusal(403, "quotaExceeded")).fetchFn).catch((error: unknown) => error);
    expect(failure).toMatchObject({ call: "youtube_session", status: 403, reason: "quotaExceeded" });
  });

  it("refuses an answer with no address, or one that is not Google's", async () => {
    for (const headers of [{}, { location: "https://evil.example/upload" }, { location: "http://www.googleapis.com/upload" }] as Record<string, string>[]) {
      const failure = await openVideoUpload("tok", upload, google(new Response(null, { status: 200, headers })).fetchFn).catch((error: unknown) => error);
      expect(failure).toMatchObject({ call: "youtube_session", reason: "unknown" });
    }
  });
});

describe("isUploadAddress", () => {
  it("is an https address at googleapis.com and nothing else", () => {
    expect(isUploadAddress(SESSION)).toBe(true);
    expect(isUploadAddress("https://youtube.googleapis.com/upload/x")).toBe(true);
    expect(isUploadAddress("https://googleapis.com.evil.example/upload")).toBe(false);
    expect(isUploadAddress("https://user:pw@www.googleapis.com/upload")).toBe(false);
    expect(isUploadAddress("not an address")).toBe(false);
  });
});

describe("uploadState", () => {
  it("asks the session without a token and reads how far it got", async () => {
    const { fetchFn, calls } = google(new Response(null, { status: 308, headers: { range: "bytes=0-499" } }));
    expect(await uploadState(SESSION, 1234, fetchFn)).toEqual({ done: false, offset: 500 });
    expect(calls[0]).toMatchObject({ url: SESSION, method: "PUT" });
    expect(calls[0].headers["content-range"]).toBe("bytes */1234");
    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it("is at 0 when nothing arrived", async () => {
    expect(await uploadState(SESSION, 1234, google(new Response(null, { status: 308 })).fetchFn)).toEqual({ done: false, offset: 0 });
  });

  it("reads the video's id from a finished upload's own answer", async () => {
    expect(await uploadState(SESSION, 1234, google(Response.json({ id: "dQw4w9WgXcQ" }, { status: 201 })).fetchFn)).toEqual({ done: true, videoId: "dQw4w9WgXcQ" });
    expect(await uploadState(SESSION, 1234, google(Response.json({ id: "not an id" })).fetchFn)).toEqual({ done: true, videoId: null });
  });

  it("says a session that is gone has expired", async () => {
    for (const status of [404, 410, 499]) {
      const failure = await uploadState(SESSION, 1234, google(new Response(null, { status })).fetchFn).catch((error: unknown) => error);
      expect(failure).toMatchObject({ call: "youtube_upload", status, reason: "expired" });
    }
  });
});

describe("cancelUpload", () => {
  it("deletes the session, and a session already gone is fine", async () => {
    const { fetchFn, calls } = google(new Response(null, { status: 499 }));
    await cancelUpload(SESSION, fetchFn);
    expect(calls[0]).toMatchObject({ url: SESSION, method: "DELETE" });
    await expect(cancelUpload(SESSION, google(new Response(null, { status: 500 })).fetchFn)).rejects.toBeInstanceOf(DriveError);
  });
});
