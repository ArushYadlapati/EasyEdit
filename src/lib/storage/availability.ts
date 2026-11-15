import "server-only";
import { mainServiceAccount } from "@/lib/drive";
import type { AccessSource } from "@/lib/drive/token";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import type { SpaceKind } from "@/lib/spaces/types";
import { type StorageConfig, storageConfig } from "./config";
import type { StorageBlock } from "./messages";

export type AvailabilityDeps = { config?: () => StorageConfig | null; mainSa?: () => AccessSource | null };

// What stops this server connecting a Google account for a space of this kind, read from its settings (no call to
// Google): the settings for connecting at all, and for a team the Google Cloud project and the app's service account
// its reader is made with. The same checks setUpStorage makes, so a page never offers a connect that is sure to fail.
// While personal spaces are not offered, a personal space reads as a server that can't set storage up: an old personal
// project's Media tab then says so, and offers no setup that would only lead back to the coming-soon page.
export function storageBlock(kind: SpaceKind, deps: AvailabilityDeps = {}): StorageBlock {
  const config = (deps.config ?? storageConfig)();
  if (!config) return "server";
  if (kind === "personal") return personalSpacesOpen() ? null : "server";
  if (!config.projectId) return "team";
  try {
    return (deps.mainSa ?? mainServiceAccount)() ? null : "team";
  } catch {
    console.error("Drive settings could not be read");
    return "team";
  }
}
