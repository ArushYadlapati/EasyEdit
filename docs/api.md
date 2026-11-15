# The project API

All routes need you to be signed in (they use the same cookie as the website). Bodies and answers are JSON, except the thumbnail route's picture, which is a JPEG.

| Route | Who may call it | What it does |
| --- | --- | --- |
| `GET /api/projects` | viewer and up | List projects: `{ "projects": [...] }` |
| `POST /api/projects` | editor and up | Create a project from `{ "name", "format" }`, with `"width"` and `"height"` in pixels when `"format"` is `"custom"`. Answers `201` with `{ "id" }`. |
| `GET /api/projects/:id` | viewer and up | Get `{ id, name, format, doc, version }`. |
| `GET /api/projects/:id/version` | viewer and up | Get just the current version: `{ version }`. |
| `POST /api/projects/:id/presence` | viewer and up | The editor's check for changes. Send `{ tabId, clipIds, trackId, changedAgoMs }` for what this tab has selected. Answers `{ version, peers }`, where each peer is `{ userId, name, clipIds, trackId }`, or just `{ version }` when selections cannot be read. |
| `DELETE /api/projects/:id/presence?tab=…` | viewer and up | A tab going away. Answers `204`. |
| `PATCH /api/projects/:id` | editor and up | Rename a project: send `{ "name" }`. Answers `{ id, name }`. |
| `DELETE /api/projects/:id` | editor and up | Delete a project. Answers `204`. |
| `POST /api/projects/:id/duplicate` | editor and up | Make a copy of a project. Answers `201` with `{ "id" }` of the copy. |
| `POST /api/projects/:id/opened` | viewer and up | Records that you opened the project, for your Recent list on the dashboard. Answers `204`. |
| `GET /api/projects/:id/thumbnail?v=N` | viewer and up | Get the project's picture for its dashboard card, a JPEG. `N` is `thumbnailVersion` from the project list; each new picture has a new `N`, so browsers keep each one. Answers `404` when the project has no picture. |
| `PUT /api/projects/:id/thumbnail?v=N` | editor and up | Store the project's picture: send a JPEG of at most 300 KB drawn from version `N`. It is kept only when `N` is newer than the stored picture's and not past the project's version, and it changes neither the version nor when the project last changed. Answers `{ saved }`. The editor sends it by itself. |
| `GET /api/projects/:id/ops?since=N` | viewer and up | Get the changes after version `N`: `{ version, entries, hasMore }`. Each entry is `{ version, ops, inverse, actor, actorName, requestId, createdAt }`. Add `limit` to set the page size (default 100, at most 500). A page holds fewer entries when they are large. When `hasMore` is true, ask again from the `version` in the answer. |
| `POST /api/projects/:id/ops` | editor and up | Apply changes: send `{ "baseVersion": N, "ops": [...] }` (1 to 500 ops). Answers `{ version, ops, inverse }`. |

Edits are versioned. Send the version you last saw as `baseVersion`. Changes that do not clash with newer edits still apply. A `baseVersion` newer than the project is refused.

`inverse` is the ops that undo this change, to send back later as an ordinary edit. To make a write that is refused unless `baseVersion` is exactly the current version, add `"strict": true`. A strict write is never applied on top of newer edits.

To make a write safe to retry, add a `"requestId"` of 8 to 64 letters, digits, `-` or `_`. If a write with that `requestId` already landed in this project, the answer is the original one and nothing is applied again. Use a new `requestId` for every change and repeat it only to resend that same change: a different change sent under a used `requestId` is not applied. Each op-log entry shows its `requestId`, or `null` when none was sent.

When a route refuses a request, the answer has this shape:

```json
{ "code": "CONFLICT", "message": "...", "opIndex": 0, "currentVersion": 3 }
```

`opIndex` (which op failed) and `currentVersion` only appear when they apply. An unexpected failure answers `500` with `{ "code": "INTERNAL", "message" }`.

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `INVALID` | The body, query, project name or an op is malformed, `ops` is empty, or the `requestId` is malformed or was already used by someone else. |
| 400 | `LIMIT_EXCEEDED` | Too many ops (more than 500), tracks or clips, a change too large to store or too large to undo in one step, or the project is too large. |
| 400 | `STALE` | An undo no longer applies, because that part of the project was changed since. |
| 400 | `NOT_FOUND`, `OVERLAP`, `WRONG_TRACK_KIND`, `TRACK_LOCKED`, `TRIM_OUT_OF_RANGE`, `DUPLICATE_ID` | A valid op could not be applied to the project. `opIndex` says which one. |
| 401 | `UNAUTHENTICATED` | Not signed in. |
| 403 | `FORBIDDEN` | Your role does not allow this, or the request came from another site. |
| 404 | `NOT_FOUND` | No project with that id. |
| 409 | `CONFLICT` | The base version is ahead of the project, a strict write was not at the current version, or the project kept changing. Reload and retry. |
