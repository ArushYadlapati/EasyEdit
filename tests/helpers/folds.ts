import { FOLDS_KEY, SECTION_ORDER, type ClipKind } from "@/lib/editor/inspector-folds";

// Every section of every kind of clip open, as if a person had opened them all, for tests of what is inside the
// sections rather than of their folding. Run before rendering (beforeEach).
export function openEverySection(): void {
  const all: Record<string, boolean> = {};
  for (const [kind, ids] of Object.entries(SECTION_ORDER) as [ClipKind, readonly string[]][]) for (const id of ids) all[`${kind}.${id}`] = true;
  window.localStorage.setItem(FOLDS_KEY, JSON.stringify(all));
}

// Each section as a kind of clip first opens it.
export function forgetFolds(): void {
  window.localStorage.removeItem(FOLDS_KEY);
}
