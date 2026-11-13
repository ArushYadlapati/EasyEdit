import type { ApiFailure, ProjectApi } from "./api";
import { MESSAGES } from "./messages";
import type { EditorStore } from "./store";

function renameMessage(failure: ApiFailure): string {
  if (failure.kind === "op") return failure.message || MESSAGES.renameFailed;
  if (failure.kind === "forbidden") return MESSAGES.readOnly;
  return MESSAGES.renameFailed;
}

// Renames the project from the editor. The new name shows at once; a refusal puts the old one
// back with the reason. A rename is not an op, so it is neither undoable nor queued offline. An
// answer only touches the name while it still shows this rename, so a late answer never undoes
// a newer one. Resolves true once the server took the name.
export async function renameFromEditor(store: EditorStore, api: ProjectApi, typed: string): Promise<boolean> {
  const state = store.getState();
  const next = typed.trim();
  if (!state.canEdit || state.status === "deleted" || next === "" || next === state.name) return false;
  const previous = state.name;
  state.setName(next);
  const answer = await api.rename(next);
  const now = store.getState();
  if (answer.ok) {
    if (now.name === next) now.setName(answer.name);
    return true;
  }
  if (now.name === next) now.setName(previous);
  now.notify("error", renameMessage(answer));
  return false;
}
