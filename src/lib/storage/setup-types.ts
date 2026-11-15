import type { DB } from "@/db";
import { ServiceError } from "@/lib/service-error";

// Makes a space's storage in the Drive of a connection its admin just made. What it refuses comes out as a ServiceError.
export type SetUpStorage = (db: DB, input: { spaceId: string; connectionId: string; byUserId: string }) => Promise<void>;

// What the routes are given until setting up storage exists: the connection is kept, and storage is not made.
export const setUpNotReady: SetUpStorage = async () => {
  throw new ServiceError("CONFLICT", 409, "Setting up storage isn't available yet.");
};
