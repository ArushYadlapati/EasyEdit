import "server-only";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import type { SpaceKind } from "@/lib/spaces/types";
import { type StorageConfig, storageConfig } from "./config";
import type { StorageBlock } from "./messages";

export type AvailabilityDeps = { config?: () => StorageConfig | null };

// What stops this server connecting a Google account for a space of this kind, read from its settings (no call to
// Google): the settings for connecting at all. The same check setUpStorage makes, so a page never offers a connect
// that is sure to fail. A team needs nothing more than a personal space: it reads with its own connection.
// While personal spaces are not offered, a personal space reads as a server that can't set storage up: an old personal
// project's Media tab then says so, and offers no setup that would only lead back to the coming-soon page.
export function storageBlock(kind: SpaceKind, deps: AvailabilityDeps = {}): StorageBlock {
  const config = (deps.config ?? storageConfig)();
  if (!config) return "server";
  if (kind === "personal") return personalSpacesOpen() ? null : "server";
  return null;
}
