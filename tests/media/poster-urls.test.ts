import { expect, it, vi } from "vitest";
import type { MediaFiles } from "@/lib/media/media-files";
import { createPosterUrls } from "@/lib/media/poster-urls";

type Got = Awaited<ReturnType<MediaFiles["get"]>>;

// Files whose reads the test answers by hand, and URL functions that count what they make and revoke.
function harness() {
  const pending = new Map<string, ((got: Got) => void)[]>();
  const get = vi.fn((fileId: string) => new Promise<Got>((resolve) => pending.set(fileId, [...(pending.get(fileId) ?? []), resolve])));
  const objectUrl = vi.fn((blob: Blob) => `blob:${(blob as Blob & { id: string }).id}`);
  const revokeUrl = vi.fn((url: string) => void url);
  const urls = createPosterUrls({ files: { get, put: async () => {} }, objectUrl, revokeUrl });
  const changes = vi.fn();
  urls.subscribe(changes);
  const answer = async (fileId: string, got: Got) => {
    for (const resolve of pending.get(fileId) ?? []) resolve(got);
    pending.delete(fileId);
    await Promise.resolve();
    await Promise.resolve();
  };
  const still = (id: string): Got => ({ ok: true, blob: Object.assign(new Blob(["jpeg"]), { id }) });
  return { urls, get, objectUrl, revokeUrl, changes, answer, still };
}

it("three holders of one still share one read and one address; the last let-go revokes it", async () => {
  const { urls, get, objectUrl, revokeUrl, changes, answer, still } = harness();
  const letGo = [urls.hold("post-a"), urls.hold("post-a"), urls.hold("post-a")];
  expect(get).toHaveBeenCalledTimes(1);
  expect(urls.url("post-a")).toBeNull();
  await answer("post-a", still("post-a"));
  expect(objectUrl).toHaveBeenCalledTimes(1);
  expect(urls.url("post-a")).toBe("blob:post-a");
  expect(changes).toHaveBeenCalledTimes(1);

  letGo[0]();
  letGo[1]();
  letGo[1](); // letting go twice counts once
  expect(revokeUrl).not.toHaveBeenCalled();
  expect(urls.url("post-a")).toBe("blob:post-a");
  letGo[2]();
  expect(revokeUrl).toHaveBeenCalledTimes(1);
  expect(revokeUrl).toHaveBeenCalledWith("blob:post-a");
  expect(urls.url("post-a")).toBeNull();
  expect(changes).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenCalledTimes(1);
});

it("a read that finishes after every holder let go makes no address", async () => {
  const { urls, get, objectUrl, revokeUrl, changes, answer, still } = harness();
  const a = urls.hold("post-a");
  const b = urls.hold("post-a");
  a();
  b();
  await answer("post-a", still("post-a"));
  expect(get).toHaveBeenCalledTimes(1);
  expect(objectUrl).not.toHaveBeenCalled();
  expect(revokeUrl).not.toHaveBeenCalled();
  expect(urls.url("post-a")).toBeNull();
  expect(changes).not.toHaveBeenCalled();
});

it("a failed read leaves nothing, and the next hold reads again", async () => {
  const { urls, get, objectUrl, changes, answer, still } = harness();
  const first = urls.hold("post-a");
  await answer("post-a", { ok: false, problem: "offline" });
  expect(objectUrl).not.toHaveBeenCalled();
  expect(urls.url("post-a")).toBeNull();
  expect(changes).not.toHaveBeenCalled();

  const second = urls.hold("post-a"); // the first holder is still there: the still is read again all the same
  expect(get).toHaveBeenCalledTimes(2);
  await answer("post-a", still("post-a"));
  expect(urls.url("post-a")).toBe("blob:post-a");
  first();
  second();
  expect(urls.url("post-a")).toBeNull();

  // A read that throws is a failure too.
  get.mockImplementationOnce(() => Promise.reject(new Error("gone")));
  const third = urls.hold("post-b");
  await Promise.resolve();
  await Promise.resolve();
  expect(urls.url("post-b")).toBeNull();
  urls.hold("post-b");
  expect(get).toHaveBeenCalledTimes(4);
  third();
});

it("two stills get two addresses", async () => {
  const { urls, get, objectUrl, revokeUrl, answer, still } = harness();
  const a = urls.hold("post-a");
  const b = urls.hold("post-b");
  expect(get.mock.calls.map(([id]) => id)).toEqual(["post-a", "post-b"]);
  await answer("post-a", still("post-a"));
  await answer("post-b", still("post-b"));
  expect(objectUrl).toHaveBeenCalledTimes(2);
  expect(urls.url("post-a")).toBe("blob:post-a");
  expect(urls.url("post-b")).toBe("blob:post-b");
  a();
  expect(revokeUrl).toHaveBeenCalledWith("blob:post-a");
  expect(urls.url("post-b")).toBe("blob:post-b");
  b();
  expect(revokeUrl).toHaveBeenCalledWith("blob:post-b");
  expect(revokeUrl).toHaveBeenCalledTimes(2);
});
