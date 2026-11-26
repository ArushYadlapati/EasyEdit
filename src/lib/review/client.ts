import { REVIEW_MESSAGES, type CommentView, type VersionView } from "./rules";

// The browser's side of review: comments and named versions of one project. Every call resolves with how it ended
// and never rejects.

export type ReviewResult<T> = ({ ok: true } & T) | { ok: false; message: string; gone?: boolean };
export type Role = "viewer" | "editor" | "admin";

export type ReviewApi = {
  comments(): Promise<ReviewResult<{ comments: CommentView[]; me: string; role: Role }>>;
  addComment(input: { frame: number; body: string; parentId?: string }): Promise<ReviewResult<{ comment: CommentView }>>;
  updateComment(id: string, patch: { body?: string; resolved?: boolean }): Promise<ReviewResult<{ comment: CommentView }>>;
  deleteComment(id: string): Promise<ReviewResult<object>>;
  versions(): Promise<ReviewResult<{ versions: VersionView[] }>>;
  saveVersion(name: string): Promise<ReviewResult<{ id: string }>>;
  renameVersion(id: string, name: string): Promise<ReviewResult<object>>;
  deleteVersion(id: string): Promise<ReviewResult<object>>;
  openVersion(id: string): Promise<ReviewResult<{ id: string }>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function createReviewApi(projectId: string, fetchFn: typeof fetch = fetch): ReviewApi {
  const base = `/api/projects/${encodeURIComponent(projectId)}`;
  async function call<T>(path: string, method: string, body?: unknown): Promise<ReviewResult<T>> {
    try {
      const response = await fetchFn(`${base}${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (response.status === 204) return { ok: true } as ReviewResult<T>;
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) return { ok: false, message: isRecord(json) && typeof json.message === "string" && json.message ? json.message : REVIEW_MESSAGES.failed, gone: response.status === 404 };
      return { ok: true, ...(isRecord(json) ? json : {}) } as ReviewResult<T>;
    } catch {
      return { ok: false, message: REVIEW_MESSAGES.failed };
    }
  }
  const id = encodeURIComponent;
  return {
    comments: () => call("/comments", "GET"),
    addComment: (input) => call("/comments", "POST", input),
    updateComment: (commentId, patch) => call(`/comments/${id(commentId)}`, "PATCH", patch),
    deleteComment: (commentId) => call(`/comments/${id(commentId)}`, "DELETE"),
    versions: () => call("/saved-versions", "GET"),
    saveVersion: (name) => call("/saved-versions", "POST", { name }),
    renameVersion: (versionId, name) => call(`/saved-versions/${id(versionId)}`, "PATCH", { name }),
    deleteVersion: (versionId) => call(`/saved-versions/${id(versionId)}`, "DELETE"),
    openVersion: (versionId) => call(`/saved-versions/${id(versionId)}/open`, "POST"),
  };
}
