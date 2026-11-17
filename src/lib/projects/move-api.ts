import { z } from "zod";
import type { CopyState, FinishedMove, MovePlan, OpenedCopy } from "./move";

// The routes for moving a project, as the browser calls them. Types only from ./move: it is server code.

// A refusal holds the server's code and its own sentence, empty when it gave none. NETWORK: no answer came, or one
// from something between the page and our server. UNEXPECTED: an answer that is not in the shape it should be.
export type MoveResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string; missing?: string[] };

export type MoveApi = {
  start(projectId: string, toSpaceId: string): Promise<MoveResult<MovePlan>>;
  openCopy(moveId: string, sourceAssetId: string): Promise<MoveResult<OpenedCopy>>;
  completeCopy(moveId: string, copyAssetId: string): Promise<MoveResult<CopyState>>;
  openCopyFile(moveId: string, copyAssetId: string, role: "preview" | "poster", sizeBytes: number): Promise<MoveResult<{ uploadUrl: string }>>;
  completeCopyFile(moveId: string, copyAssetId: string, role: "preview" | "poster"): Promise<MoveResult<CopyState>>;
  finish(moveId: string): Promise<MoveResult<FinishedMove>>;
  projectSpace(projectId: string): Promise<MoveResult<{ spaceId: string; version: number }>>; // where the project is now
  abandon(moveId: string): Promise<void>; // never throws: a move left open is resumed or ends on its own
};

const NETWORK = { ok: false, code: "NETWORK", message: "" } as const;
const UNEXPECTED = { ok: false, code: "UNEXPECTED", message: "" } as const;

const copyState: z.ZodType<CopyState> = z.object({ assetId: z.string(), status: z.enum(["uploading", "ready"]), hasPreview: z.boolean(), hasPoster: z.boolean() });
const plan: z.ZodType<MovePlan> = z.object({
  moveId: z.string(),
  projectId: z.string(),
  to: z.object({ id: z.string(), name: z.string(), slug: z.string(), kind: z.enum(["personal", "team"]) }),
  items: z.array(
    z.object({
      sourceAssetId: z.string(),
      kind: z.enum(["video", "image", "audio"]),
      name: z.string(),
      sizeBytes: z.number(),
      originalFileId: z.string(),
      previewFileId: z.string().nullable(),
      posterFileId: z.string().nullable(),
      copy: copyState.nullable(),
    }),
  ),
});
const openedCopy: z.ZodType<OpenedCopy> = z.object({ copyAssetId: z.string(), uploadUrl: z.string().nullable(), offset: z.number(), done: z.boolean() });
const fileOpened = z.object({ uploadUrl: z.string() });
const finished: z.ZodType<FinishedMove> = z.object({ projectId: z.string(), spaceId: z.string(), slug: z.string(), version: z.number() });
const projectAt = z.object({ spaceId: z.string(), version: z.number() });
const refusal = z.object({ code: z.string(), message: z.string().optional(), missing: z.array(z.string()).optional() });

const moves = (moveId: string, rest = "") => `/api/moves/${encodeURIComponent(moveId)}${rest}`;
const copies = (moveId: string, copyAssetId: string, rest: string) => moves(moveId, `/copies/${encodeURIComponent(copyAssetId)}${rest}`);

export function createMoveApi(fetchFn?: typeof fetch): MoveApi {
  const doFetch: typeof fetch = fetchFn ?? ((input, init) => fetch(input, init));

  // One request to the page's own origin. No call throws: whatever goes wrong is a refusal.
  async function request<T>(method: "GET" | "POST" | "DELETE", path: string, shape: z.ZodType<T>, body?: unknown): Promise<MoveResult<T>> {
    let response: Response;
    let text: string;
    try {
      response = await doFetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
      text = await response.text();
    } catch {
      return NETWORK;
    }
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON: an empty answer, or a page from something in between.
    }
    if (response.ok) {
      const parsed = shape.safeParse(json);
      return parsed.success ? { ok: true, value: parsed.data } : UNEXPECTED;
    }
    const said = refusal.safeParse(json);
    // Our server always says why. An answer that does not, with a 5xx, came from something in between.
    if (!said.success) return response.status >= 500 ? NETWORK : UNEXPECTED;
    const { code, message = "", missing } = said.data;
    return missing ? { ok: false, code, message, missing } : { ok: false, code, message };
  }

  return {
    start: (projectId, toSpaceId) => request("POST", `/api/projects/${encodeURIComponent(projectId)}/move`, plan, { toSpaceId }),
    openCopy: (moveId, sourceAssetId) => request("POST", moves(moveId, "/copies"), openedCopy, { sourceAssetId }),
    completeCopy: (moveId, copyAssetId) => request("POST", copies(moveId, copyAssetId, "/complete"), copyState),
    openCopyFile: (moveId, copyAssetId, role, sizeBytes) => request("POST", copies(moveId, copyAssetId, "/files"), fileOpened, { role, sizeBytes }),
    completeCopyFile: (moveId, copyAssetId, role) => request("POST", copies(moveId, copyAssetId, "/files/complete"), copyState, { role }),
    finish: (moveId) => request("POST", moves(moveId, "/finish"), finished),
    projectSpace: (projectId) => request("GET", `/api/projects/${encodeURIComponent(projectId)}/version`, projectAt),
    abandon: async (moveId) => {
      await request("DELETE", moves(moveId), z.unknown());
    },
  };
}
