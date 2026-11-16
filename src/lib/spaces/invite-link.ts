import "server-only";
import { requiredEnv } from "@/lib/env";

// The address an invitee opens. Server-only: BETTER_AUTH_URL is not available to the browser.
export function inviteUrl(id: string): string {
  return `${new URL(requiredEnv("BETTER_AUTH_URL")).origin}/invite/${id}`;
}
