import { describe, expect, it } from "vitest";
import { DriveError } from "@/lib/drive/token";
import { channelVideo, durationSeconds, listMyUploads } from "@/lib/social/youtube-api";

type Call = { url: string; method: string; headers: Record<string, string> };

// A pretend YouTube that answers each request with the next of `answers` and keeps what it was asked.
function youtube(...answers: Response[]) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => (headers[name] = value));
    calls.push({ url: String(input), method: init?.method ?? "GET", headers });
    const next = answers.shift();
    if (!next) throw new Error("no answer left");
    return next;
  }) as typeof fetch;
  return { fetchFn, calls };
}

const refusal = (status: number, reason: string) => Response.json({ error: { code: status, errors: [{ reason }] } }, { status });

const API = "https://www.googleapis.com/youtube/v3";
const CHANNEL = "UC123";
const UPLOADS = "UU123";
const ids = ["aaaaaaaaaa1", "aaaaaaaaaa2", "aaaaaaaaaa3"];

const channelAnswer = (uploads: string | null = UPLOADS) =>
  Response.json({ items: [{ id: CHANNEL, contentDetails: { relatedPlaylists: uploads === null ? {} : { uploads, likes: "" } } }] });
const playlistAnswer = (videoIds: string[]) =>
  Response.json({ items: videoIds.map((videoId, n) => ({ id: `item${n}`, snippet: { title: "ignored", resourceId: { kind: "youtube#video", videoId } }, contentDetails: { videoId } })) });

// A video as YouTube's videos answer describes it, public unless told otherwise (null: the answer doesn't say).
function video(id: string, over: { snippet?: Record<string, unknown>; duration?: string; privacy?: string | null } = {}) {
  return {
    id,
    snippet: {
      channelId: CHANNEL,
      channelTitle: "Seattle Solvers",
      title: `Match day ${id.at(-1)}`,
      description: "We won!\n\nThanks for watching.",
      tags: ["robotics", "FTC"],
      thumbnails: {
        default: { url: `https://i.ytimg.com/vi/${id}/default.jpg` },
        medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` },
        high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` },
      },
      ...over.snippet,
    },
    contentDetails: { duration: over.duration ?? "PT1M5S" },
    ...(over.privacy !== null && { status: { privacyStatus: over.privacy ?? "public", uploadStatus: "processed" } }),
  };
}
const videosAnswer = (...items: unknown[]) => Response.json({ items });

describe("listMyUploads", () => {
  it("reads the channel's uploads list, then its newest videos, then each one's facts", async () => {
    const { fetchFn, calls } = youtube(channelAnswer(), playlistAnswer(ids), videosAnswer(...ids.map((id) => video(id))));
    const uploads = await listMyUploads("tok", fetchFn);
    expect(calls.map((call) => call.url)).toEqual([
      `${API}/channels?part=contentDetails&mine=true&maxResults=1`,
      `${API}/playlistItems?part=snippet,contentDetails&playlistId=UU123&maxResults=50`,
      `${API}/videos?part=snippet,contentDetails,status&id=aaaaaaaaaa1,aaaaaaaaaa2,aaaaaaaaaa3`,
    ]);
    expect(calls.every((call) => call.method === "GET" && call.headers.authorization === "Bearer tok")).toBe(true);
    expect(uploads).toHaveLength(3);
    expect(uploads[0]).toEqual({
      id: "aaaaaaaaaa1",
      url: "https://www.youtube.com/watch?v=aaaaaaaaaa1",
      title: "Match day 1",
      author: "Seattle Solvers",
      thumbnailUrl: "https://i.ytimg.com/vi/aaaaaaaaaa1/mqdefault.jpg",
      seconds: 65,
      description: "We won! Thanks for watching.",
      tags: ["robotics", "FTC"],
    });
  });

  it("keeps the uploads list's order, newest first, whatever order the facts come back in", async () => {
    const { fetchFn } = youtube(channelAnswer(), playlistAnswer(ids), videosAnswer(...[...ids].reverse().map((id) => video(id))));
    expect((await listMyUploads("tok", fetchFn)).map((upload) => upload.id)).toEqual(ids);
  });

  it("keeps as many as it's told, at most 50, picked from the 50 newest uploads", async () => {
    const many = Array.from({ length: 60 }, (_, n) => `vid${String(n).padStart(8, "0")}`);
    let yt = youtube(channelAnswer(), playlistAnswer(many), videosAnswer(...many.map((id) => video(id))));
    expect((await listMyUploads("tok", yt.fetchFn, 5)).map((upload) => upload.id)).toEqual(many.slice(0, 5));
    expect(yt.calls[1].url).toContain("maxResults=50");
    expect(yt.calls[2].url).toBe(`${API}/videos?part=snippet,contentDetails,status&id=${many.slice(0, 50).join(",")}`);
    yt = youtube(channelAnswer(), playlistAnswer(many), videosAnswer(...many.map((id) => video(id))));
    expect(await listMyUploads("tok", yt.fetchFn, 500)).toHaveLength(50);
    yt = youtube(channelAnswer(), playlistAnswer(ids), videosAnswer(...ids.map((id) => video(id))));
    expect(await listMyUploads("tok", yt.fetchFn, 2)).toHaveLength(2);
  });

  it("offers only public videos: private and unlisted ones, and one whose answer doesn't say, are left out", async () => {
    const all = ["aaaaaaaaaa1", "aaaaaaaaaa2", "aaaaaaaaaa3", "aaaaaaaaaa4", "aaaaaaaaaa5"];
    const { fetchFn, calls } = youtube(
      channelAnswer(),
      playlistAnswer(all),
      videosAnswer(video(all[0], { privacy: "private" }), video(all[1]), video(all[2], { privacy: "unlisted" }), video(all[3], { privacy: null }), video(all[4])),
    );
    // Asked for two, it still finds two public ones past the private and unlisted ones.
    expect((await listMyUploads("tok", fetchFn, 2)).map((upload) => upload.id)).toEqual([all[1], all[4]]);
    expect(new URL(calls[2].url).searchParams.get("part")).toBe("snippet,contentDetails,status");
  });

  it("is empty for an account with no channel, or a channel with no uploads", async () => {
    for (const answers of [
      [Response.json({ items: [] })],
      [Response.json({})],
      [channelAnswer(null)],
      [channelAnswer(), playlistAnswer([])],
      [channelAnswer(), refusal(404, "playlistNotFound")],
    ]) {
      const { fetchFn, calls } = youtube(...answers);
      expect(await listMyUploads("tok", fetchFn)).toEqual([]);
      expect(calls.some((call) => call.url.includes("/videos?"))).toBe(false);
    }
  });

  it("puts the uploads list's id into the address safely, and skips ids that aren't a video's", async () => {
    const { fetchFn, calls } = youtube(channelAnswer("UU1&x=2"), playlistAnswer(["short", "aaaaaaaaaa1", "aaaaaaaaaa1", "a/b?c=dddddd"]), videosAnswer(video(ids[0])));
    expect((await listMyUploads("tok", fetchFn)).map((upload) => upload.id)).toEqual(["aaaaaaaaaa1"]);
    expect(calls[1].url).toContain("playlistId=UU1%26x%3D2&");
    expect(calls[2].url).toBe(`${API}/videos?part=snippet,contentDetails,status&id=aaaaaaaaaa1`);
  });

  it("leaves out a video YouTube didn't describe, one with no title, and one on another channel", async () => {
    const { fetchFn } = youtube(
      channelAnswer(),
      playlistAnswer(ids),
      videosAnswer(video(ids[0], { snippet: { title: "  " } }), video(ids[1], { snippet: { channelId: "UCother" } }), { id: "aaaaaaaaaa9" }),
    );
    expect(await listMyUploads("tok", fetchFn)).toEqual([]);
  });

  it("keeps pictures only from YouTube's image servers, the medium one first, then the high one", async () => {
    const thumbs = (medium: string | null, high: string | null) => ({
      thumbnails: {
        default: { url: "https://i.ytimg.com/vi/x/default.jpg" },
        ...(medium !== null && { medium: { url: medium } }),
        ...(high !== null && { high: { url: high } }),
      },
    });
    const { fetchFn } = youtube(
      channelAnswer(),
      playlistAnswer(ids),
      videosAnswer(
        video(ids[0], { snippet: thumbs("https://evil.example/mq.jpg", "https://i.ytimg.com/vi/x/hqdefault.jpg") }),
        video(ids[1], { snippet: thumbs("http://i.ytimg.com/vi/x/mq.jpg", "https://user:pw@i.ytimg.com/vi/x/hq.jpg") }),
        video(ids[2], { snippet: thumbs(null, null) }),
      ),
    );
    const uploads = await listMyUploads("tok", fetchFn);
    expect(uploads.map((upload) => upload.thumbnailUrl)).toEqual(["https://i.ytimg.com/vi/x/hqdefault.jpg", undefined, undefined]);
    expect("thumbnailUrl" in uploads[1]).toBe(false);
  });

  it("cuts a description to 500 characters on one line, and keeps at most 15 tags", async () => {
    const tags = [...Array.from({ length: 20 }, (_, n) => `tag ${n}`), 7, "   ", "x".repeat(150)];
    const { fetchFn } = youtube(
      channelAnswer(),
      playlistAnswer(ids.slice(0, 2)),
      videosAnswer(video(ids[0], { snippet: { description: `${"word ".repeat(200)}\u202eend`, tags } }), video(ids[1], { snippet: { description: "", tags: "nope", channelTitle: 5 } })),
    );
    const [long, bare] = await listMyUploads("tok", fetchFn);
    expect(long.description).toHaveLength(500);
    expect(long.description).toMatch(/^word word .*…$/);
    expect(long.description).not.toMatch(/[\n\u202e]/);
    expect(long.tags).toEqual(Array.from({ length: 15 }, (_, n) => `tag ${n}`));
    expect(bare).toEqual({ id: ids[1], url: `https://www.youtube.com/watch?v=${ids[1]}`, title: "Match day 2", thumbnailUrl: `https://i.ytimg.com/vi/${ids[1]}/mqdefault.jpg`, seconds: 65 });
  });

  it("turns a refusal at any step into the call, the status and Google's short code", async () => {
    for (const [answers, call, status, reason] of [
      [[refusal(403, "insufficientPermissions")], "youtube_channel", 403, "insufficientPermissions"],
      [[channelAnswer(), refusal(403, "quotaExceeded")], "youtube_playlist", 403, "quotaExceeded"],
      [[channelAnswer(), refusal(404, "notFound")], "youtube_playlist", 404, "notFound"],
      [[channelAnswer(), playlistAnswer(ids), refusal(500, "backendError")], "youtube_video", 500, "backendError"],
    ] as const) {
      const failure = await listMyUploads("tok", youtube(...answers).fetchFn).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DriveError);
      expect(failure).toMatchObject({ call, status, reason });
    }
  });

  it("says so when YouTube doesn't answer at all, without the address", async () => {
    const fetchFn = (async () => {
      throw new TypeError("fetch failed: https://www.googleapis.com/youtube/v3/channels?mine=true");
    }) as typeof fetch;
    const failure = await listMyUploads("tok", fetchFn).catch((error: unknown) => error);
    expect(failure).toMatchObject({ call: "youtube_channel", status: 0, reason: "unreachable" });
    expect(String((failure as Error).message)).not.toContain("googleapis");
  });
});

describe("channelVideo", () => {
  it("describes one video as the uploads list does, with the channel it is on", async () => {
    const { fetchFn, calls } = youtube(videosAnswer(video(ids[0], { duration: "PT2H3M" })));
    expect(await channelVideo("tok", ids[0], fetchFn)).toEqual({
      id: ids[0],
      url: `https://www.youtube.com/watch?v=${ids[0]}`,
      title: "Match day 1",
      author: "Seattle Solvers",
      thumbnailUrl: `https://i.ytimg.com/vi/${ids[0]}/mqdefault.jpg`,
      seconds: 7380,
      description: "We won! Thanks for watching.",
      tags: ["robotics", "FTC"],
      channelId: CHANNEL,
    });
    expect(calls).toEqual([{ url: `${API}/videos?part=snippet,contentDetails,status&id=${ids[0]}`, method: "GET", headers: { authorization: "Bearer tok" } }]);
  });

  it("is null for a video YouTube doesn't show, one that names no channel, and an id that isn't a video's, which isn't asked about", async () => {
    expect(await channelVideo("tok", ids[0], youtube(videosAnswer()).fetchFn)).toBeNull();
    expect(await channelVideo("tok", ids[0], youtube(Response.json({})).fetchFn)).toBeNull();
    expect(await channelVideo("tok", ids[0], youtube(videosAnswer(video(ids[0], { snippet: { channelId: "" } }))).fetchFn)).toBeNull();
    const { fetchFn, calls } = youtube();
    for (const id of ["", "short", "aaaaaaaaaa1,aaaaaaaaaa2", "aaaaaaa/../"]) expect(await channelVideo("tok", id, fetchFn)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("is null for a private or unlisted video, and one whose answer doesn't say it is public", async () => {
    for (const privacy of ["private", "unlisted", "", null]) {
      expect(await channelVideo("tok", ids[0], youtube(videosAnswer(video(ids[0], { privacy }))).fetchFn), String(privacy)).toBeNull();
    }
  });

  it("keeps YouTube's reason when it refuses", async () => {
    const failure = await channelVideo("tok", ids[0], youtube(refusal(403, "forbidden")).fetchFn).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DriveError);
    expect(failure).toMatchObject({ call: "youtube_video", status: 403, reason: "forbidden" });
  });
});

describe("durationSeconds", () => {
  it("reads YouTube's lengths", () => {
    expect(durationSeconds("PT15S")).toBe(15);
    expect(durationSeconds("PT1M5S")).toBe(65);
    expect(durationSeconds("PT2H")).toBe(7200);
    expect(durationSeconds("PT1H2M3S")).toBe(3723);
    expect(durationSeconds("PT12.5S")).toBe(12.5);
    expect(durationSeconds("P1DT2H3M4S")).toBe(93_784);
    expect(durationSeconds("P2D")).toBe(172_800);
  });

  it("is undefined for no length, and for anything that isn't one", () => {
    for (const value of ["P0D", "PT0S", "P", "PT", "P1DT", "1M5S", "PT1M5", "PT-5S", "PT5s", "pt5s", " PT5S", "PT5S ", "PT1S2M", "", 65, null, undefined]) {
      expect(durationSeconds(value), String(value)).toBeUndefined();
    }
  });
});
