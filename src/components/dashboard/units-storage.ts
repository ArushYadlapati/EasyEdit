import type { Units } from "@/lib/editor/settings";

// The New project dialog's own unit choice, kept in this browser. The editor's units live in its cookie, which the
// dashboard cannot read, so the two are separate choices.
export const DIALOG_UNITS_KEY = "easyedit.new-project-units";

const UNITS: readonly string[] = ["px", "cm", "in"] satisfies Units[];

// The saved unit, or Pixels when none is saved, the value is not a unit, or the storage is blocked.
export function readDialogUnits(storage: Pick<Storage, "getItem">): Units {
  try {
    const saved = storage.getItem(DIALOG_UNITS_KEY);
    return saved !== null && UNITS.includes(saved) ? (saved as Units) : "px";
  } catch {
    return "px";
  }
}

// A refused write (blocked or full storage) only means the choice is not remembered.
export function writeDialogUnits(storage: Pick<Storage, "setItem">, units: Units): void {
  try {
    storage.setItem(DIALOG_UNITS_KEY, units);
  } catch {
    // nothing to do
  }
}
