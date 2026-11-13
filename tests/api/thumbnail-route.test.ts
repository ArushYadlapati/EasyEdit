import { describe, expect, it, vi } from "vitest";
import { user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { makeProjectHandlers } from "@/lib/projects/handlers";
import { createProject, deleteProject } from "@/lib/projects/service";
import { makeTestDb } from "../helpers/db";

const EDITOR = { userId: "u1", email: "u1@gmail.com", role: "editor" } as const;

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const YEAR = "private, max-age=31536000, immutable";

function userWith(role: CurrentUser["role"]): CurrentUser {
  return { id: "u1", email: "u1@gmail.com", name: "U1", image: null, role };
}

async function setup(role: CurrentUser["role"]) {
  const db = await makeTestDb();
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@gmail.com" });
  const auth = vi.fn<(req: Request) => Promise<CurrentUser | Response>>(async () => userWith(role));
  const { id } = await createProject(db, EDITOR, { name: "P", format: "short_9x16" });
  return { db, auth, id, projects: makeProjectHandlers({ db: () => db, auth }) };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const put = (id: string, v: number | string, bytes: Uint8Array<ArrayBuffer>, headers?: Record<string, string>) =>
  new Request(`http://x/api/projects/${id}/thumbnail?v=${v}`, {
    method: "PUT",
    body: bytes,
    headers: { "content-type": "image/jpeg", ...headers },
  });

const get = (id: string, v = "0") => new Request(`http://x/api/projects/${id}/thumbnail?v=${v}`);

// Starts FF D8 FF, so only its size is wrong.
function oversized(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(307_201);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
}

const bytesOf = async (res: Response) => [...new Uint8Array(await res.arrayBuffer())];

describe("the thumbnail route", () => {
  it("an editor's PUT keeps the picture and answers JSON; GET serves it for a year-long private cache", async () => {
    const { projects, auth, id } = await setup("editor");
    const saved = await projects.putThumbnail(put(id, 0, JPEG_BYTES), ctx(id));
    expect(saved.status).toBe(200);
    expect(saved.headers.get("content-type")).toContain("application/json");
    expect(await saved.json()).toEqual({ saved: true });

    const res = await projects.getThumbnail(get(id), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe(YEAR);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await bytesOf(res)).toEqual([...JPEG_BYTES]);
    expect(auth).toHaveBeenCalledWith(expect.any(Request));
  });

  it("the same version again answers saved false", async () => {
    const { projects, id } = await setup("editor");
    await projects.putThumbnail(put(id, 0, JPEG_BYTES), ctx(id));
    const again = await projects.putThumbnail(put(id, 0, JPEG_BYTES), ctx(id));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ saved: false });
  });

  it("a viewer reads pictures but cannot store one", async () => {
    const { projects, auth, id } = await setup("editor");
    expect(await (await projects.putThumbnail(put(id, 0, JPEG_BYTES), ctx(id))).json()).toEqual({ saved: true });

    auth.mockResolvedValue(userWith("viewer"));
    const req = put(id, 0, oversized());
    const refused = await projects.putThumbnail(req, ctx(id));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: "FORBIDDEN", message: "Your role doesn't allow this." });
    expect(req.bodyUsed).toBe(false);

    const res = await projects.getThumbnail(get(id), ctx(id));
    expect(res.status).toBe(200);
    expect(await bytesOf(res)).toEqual([...JPEG_BYTES]);
  });

  it("a signed-out GET is refused and serves no picture", async () => {
    const { projects, auth, id } = await setup("editor");
    await projects.putThumbnail(put(id, 0, JPEG_BYTES), ctx(id));
    auth.mockResolvedValue(new Response(null, { status: 401 }));
    const res = await projects.getThumbnail(get(id), ctx(id));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).not.toBe("image/jpeg");
  });

  it("a signed-out PUT is refused before its body is read", async () => {
    const { projects, auth, id } = await setup("editor");
    auth.mockResolvedValue(new Response(null, { status: 401 }));
    const req = put(id, 0, JPEG_BYTES);
    expect((await projects.putThumbnail(req, ctx(id))).status).toBe(401);
    expect(req.bodyUsed).toBe(false);
    auth.mockResolvedValue(userWith("editor"));
    expect((await projects.getThumbnail(get(id), ctx(id))).status).toBe(404);
  });

  it("GET answers 404 for a project with no picture, an unknown one and a deleted one", async () => {
    const { db, projects, id } = await setup("editor");
    const { id: deleted } = await createProject(db, EDITOR, { name: "Gone", format: "short_9x16" });
    await projects.putThumbnail(put(deleted, 0, JPEG_BYTES), ctx(deleted));
    await deleteProject(db, EDITOR, deleted);

    for (const missing of [id, "nope", deleted]) {
      const res = await projects.getThumbnail(get(missing), ctx(missing));
      expect(res.status, missing).toBe(404);
      expect(await res.json()).toEqual({ code: "NOT_FOUND", message: `Project "${missing}" not found` });
      expect(res.headers.get("cache-control")).toBeNull();
    }
  });

  it("a GET for another version is served but not kept", async () => {
    const { projects, id } = await setup("editor");
    await projects.putThumbnail(put(id, 0, JPEG_BYTES), ctx(id));
    expect((await projects.getThumbnail(get(id, "0"), ctx(id))).headers.get("cache-control")).toBe(YEAR);

    const others = [get(id, "5"), get(id, "x"), new Request(`http://x/api/projects/${id}/thumbnail`)];
    for (const req of others) {
      const res = await projects.getThumbnail(req, ctx(id));
      expect(res.status, req.url).toBe(200);
      expect(res.headers.get("cache-control"), req.url).toBe("private, no-cache");
      expect(await bytesOf(res)).toEqual([...JPEG_BYTES]);
    }
  });

  it("PUT refuses a bad version, a body that is not a JPEG, and one over 300 KB", async () => {
    const { projects, id } = await setup("editor");
    const badVersions = [
      put(id, "x", JPEG_BYTES),
      put(id, "-1", JPEG_BYTES),
      put(id, "1.5", JPEG_BYTES),
      put(id, "2147483648", JPEG_BYTES),
      new Request(`http://x/api/projects/${id}/thumbnail`, { method: "PUT", body: JPEG_BYTES, headers: { "content-type": "image/jpeg" } }),
    ];
    for (const req of badVersions) {
      const res = await projects.putThumbnail(req, ctx(id));
      expect(res.status, req.url).toBe(400);
      expect(await res.json()).toEqual({ code: "INVALID", message: "v must be a non-negative integer" });
    }

    const png = await projects.putThumbnail(put(id, 0, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), ctx(id));
    expect(png.status).toBe(400);
    expect(await png.json()).toEqual({ code: "INVALID", message: "A thumbnail must be a JPEG." });

    const big = put(id, 0, oversized());
    expect(big.headers.get("content-length")).toBeNull();
    const tooBig = await projects.putThumbnail(big, ctx(id));
    expect(tooBig.status).toBe(400);
    expect(await tooBig.json()).toEqual({ code: "LIMIT_EXCEEDED", message: "A thumbnail can be at most 300 KB." });

    expect((await projects.getThumbnail(get(id), ctx(id))).status).toBe(404);
  });

  it("a declared length over 300 KB is refused before the body is read", async () => {
    const { projects, id } = await setup("editor");
    const req = put(id, 0, JPEG_BYTES, { "content-length": "400000" });
    const res = await projects.putThumbnail(req, ctx(id));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "LIMIT_EXCEEDED", message: "A thumbnail can be at most 300 KB." });
    expect(req.bodyUsed).toBe(false);
    expect((await projects.getThumbnail(get(id), ctx(id))).status).toBe(404);
  });

  it("a PUT from another site is refused", async () => {
    const { projects, id } = await setup("editor");
    const res = await projects.putThumbnail(put(id, 0, JPEG_BYTES, { origin: "https://elsewhere.test", host: "x" }), ctx(id));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "FORBIDDEN", message: "This request came from another site." });
    expect((await projects.getThumbnail(get(id), ctx(id))).status).toBe(404);
  });
});
