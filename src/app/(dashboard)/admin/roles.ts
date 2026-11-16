import type { Role } from "@/lib/allowlist/service";

// The roles an admin can give, in the order the pickers list them, each with the words a person reads.
// What each can do: src/lib/access-rules.ts (meetsRole), and the editor checks in the dashboard, editor and connector tools.
export const ROLE_CHOICES: readonly { value: Role; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Edits projects and manages members." },
  { value: "editor", label: "Editor", hint: "Creates and edits projects." },
];

export function roleChoice(value: string) {
  return ROLE_CHOICES.find((choice) => choice.value === value);
}
