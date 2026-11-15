import { type DriveClient, sharedFolderClient } from "./client";
import { driveConfig, serviceAccountKey } from "./config";
import { type AccessSource, SCOPE_CLOUD, serviceAccountSource } from "./token";

const globalForDrive = globalThis as typeof globalThis & { __easyEditDrive?: DriveClient; __easyEditMainSa?: AccessSource };

// The server's one client for the shared folder (Seattle Solvers), or null when media is not set up.
// The settings are read on first use, never when this module loads, so a build with no settings works.
// "Not set up" and a key that cannot be read are not remembered: the next call reads the settings again.
export function getDrive(): DriveClient | null {
  if (!globalForDrive.__easyEditDrive) {
    const config = driveConfig();
    if (!config) return null;
    globalForDrive.__easyEditDrive = sharedFolderClient(config);
  }
  return globalForDrive.__easyEditDrive;
}

// The app's own service account, for the Cloud scope: it makes each team's reader and asks IAM for the reader's
// tokens. Never handed out. null when its key isn't set; throws, as getDrive does, when the key can't be read.
// Only the key is needed, not the shared folder's setting.
export function mainServiceAccount(): AccessSource | null {
  if (!globalForDrive.__easyEditMainSa) {
    const key = serviceAccountKey();
    if (!key) return null;
    globalForDrive.__easyEditMainSa = serviceAccountSource({ ...key, scope: SCOPE_CLOUD });
  }
  return globalForDrive.__easyEditMainSa;
}
