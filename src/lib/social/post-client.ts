import { LIMITS } from "@/lib/limits";
import { blobSource, createDriveTransport, sendFile } from "@/lib/media/uploader";
import { SOCIAL_MESSAGES } from "./messages";
import type { PostingStatus } from "./posts";
import { isVideoId, type PostForm, videoUrl } from "./rules";

// The browser's side of posting a video to YouTube: asks the server to open the upload, sends the file straight to
// YouTube a piece at a time (the media library's own sender), then asks the server to record the post. No token is
// ever held here: the upload's address is the permission, and it is a secret, so nothing here logs it.

export type PostOutcome = { status: "posted"; url: string | null } | { status: "canceled" } | { status: "failed"; message: string };

export type PostInput = { projectId: string; form: PostForm; file: Blob; signal: AbortSignal; onProgress(sentBytes: number): void };

export type Posting = {
  // What the editor may offer for this project. A server that can't be asked reads as no posting.
  status(projectId: string): Promise<PostingStatus>;
  // Posts the file. Resolves with how it ended; never rejects.
  post(input: PostInput): Promise<PostOutcome>;
};

export type PostingDeps = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; chunkBytes?: number };

const NONE: PostingStatus = { available: false };
const FINISH_WAITS_MS = [1000, 2000, 4000, 8000]; // between tries to record a post whose bytes are all at YouTube

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const failed = (message: string): PostOutcome => ({ status: "failed", message });

// The sentence in a refusal from our server, or the one given.
async function messageOf(response: Response, otherwise: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return isRecord(body) && typeof body.message === "string" && body.message !== "" ? body.message : otherwise;
}

function statusOf(body: unknown): PostingStatus {
  if (!isRecord(body) || body.available !== true || typeof body.settingsPath !== "string") return NONE;
  return {
    available: true,
    channel: typeof body.channel === "string" ? body.channel : null,
    broken: body.broken === true,
    canConnect: body.canConnect === true,
    settingsPath: body.settingsPath,
  };
}

// Why the server ended the upload while its offset was asked: thrown out of the sender, with the server's sentence.
class PostEnded extends Error {}

export function createPosting(deps: PostingDeps = {}): Posting {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const json = (body: unknown, more: RequestInit = {}): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...more });

  return {
    async status(projectId) {
      try {
        const answer = await doFetch(`/api/social/youtube/status?project=${encodeURIComponent(projectId)}`, { cache: "no-store" });
        return answer.ok ? statusOf(await answer.json().catch(() => null)) : NONE;
      } catch {
        return NONE;
      }
    },

    async post({ projectId, form, file, signal, onProgress }) {
      // Not stopped by Cancel: the server opens the upload either way, and only its answer says which post to end.
      let opened: Response;
      try {
        opened = await doFetch("/api/social/youtube/posts", json({ projectId, ...form, sizeBytes: file.size }));
      } catch {
        return failed(SOCIAL_MESSAGES.postFailed);
      }
      if (!opened.ok) return failed(await messageOf(opened, SOCIAL_MESSAGES.postFailed));
      const started: unknown = await opened.json().catch(() => null);
      if (!isRecord(started) || typeof started.id !== "string" || typeof started.uploadUrl !== "string") return failed(SOCIAL_MESSAGES.postFailed);
      const { id, uploadUrl } = started;
      const call = (step: "offset" | "finish" | "cancel", body: unknown, more: RequestInit = {}) =>
        doFetch(`/api/social/youtube/posts/${encodeURIComponent(id)}/${step}`, json(body, more));
      // Tells the server the post is over, so the upload ends at YouTube. Best effort: it also runs as the page goes.
      // The server asks YouTube first, and says "posted" when the whole video turned out to be there after all.
      const stop = async (didFail: boolean, otherwise: PostOutcome): Promise<PostOutcome> => {
        try {
          const answer = await call("cancel", didFail ? { failed: true } : {}, { keepalive: true });
          const body: unknown = answer.ok ? await answer.json().catch(() => null) : null;
          if (isRecord(body) && body.status === "posted") return { status: "posted", url: typeof body.url === "string" ? body.url : null };
        } catch {
          // The post stays "uploading" on the server; nothing more can be done from here.
        }
        return otherwise;
      };
      if (signal.aborted) return stop(false, { status: "canceled" });

      // YouTube answers the last piece with the video. Its id is kept for the server, which asks YouTube itself and
      // uses this one only when that answer names none.
      let videoId: string | null = null;
      const watching: typeof fetch = async (input, init) => {
        const answer = await doFetch(input, init);
        if (answer.status === 200 || answer.status === 201) {
          const body: unknown = await answer.clone().json().catch(() => null);
          if (isRecord(body) && isVideoId(body.id)) videoId = body.id;
        }
        return answer;
      };

      let sent: Awaited<ReturnType<typeof sendFile>>;
      try {
        sent = await sendFile(
          blobSource(file),
          { uploadUrl, offset: 0 },
          {
            transport: createDriveTransport(watching),
            async askOffset() {
              let answer: Response;
              try {
                answer = await call("offset", {});
              } catch {
                return null;
              }
              // The server says the post is over (YouTube closed the upload): no use trying on.
              if (answer.status === 409 || answer.status === 410 || answer.status === 404) throw new PostEnded(await messageOf(answer, SOCIAL_MESSAGES.uploadStopped));
              if (!answer.ok) return null;
              const body: unknown = await answer.json().catch(() => null);
              return isRecord(body) && typeof body.offset === "number" && typeof body.done === "boolean" ? { offset: body.offset, done: body.done } : null;
            },
            sleep,
            chunkBytes: deps.chunkBytes ?? LIMITS.mediaChunkBytes,
            signal,
            onProgress,
          },
        );
      } catch (error) {
        if (signal.aborted) return stop(false, { status: "canceled" });
        if (error instanceof PostEnded) return failed(error.message);
        return stop(true, failed(SOCIAL_MESSAGES.uploadStopped));
      }
      if (!sent.ok) {
        if (sent.reason === "canceled") return stop(false, { status: "canceled" });
        return stop(true, failed(sent.reason === "expired" ? SOCIAL_MESSAGES.expired : SOCIAL_MESSAGES.uploadStopped));
      }

      // Every byte is at YouTube. The post is recorded by the server; a try that did not get through is made again.
      for (let attempt = 0; ; attempt++) {
        let answer: Response | null = null;
        try {
          answer = await call("finish", videoId ? { videoId } : {});
        } catch {
          // No answer: tried again below.
        }
        if (answer?.ok) {
          const body: unknown = await answer.json().catch(() => null);
          return { status: "posted", url: isRecord(body) && typeof body.url === "string" ? body.url : null };
        }
        const again = answer === null || answer.status >= 500;
        if (again && attempt < FINISH_WAITS_MS.length) {
          await sleep(FINISH_WAITS_MS[attempt]);
          continue;
        }
        // The video is at YouTube; only EasyEdit's record of it is missing. Never an invitation to post it twice.
        if (again) return videoId ? { status: "posted", url: videoUrl(videoId) } : failed(SOCIAL_MESSAGES.unconfirmed);
        return failed(await messageOf(answer!, SOCIAL_MESSAGES.postFailed));
      }
    },
  };
}
