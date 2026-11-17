import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { appBaseUrl } from "@/lib/connector/config";
import { storageFor } from "@/lib/spaces/storage";
import { makeMoveHandlers } from "@/lib/projects/move-handlers";

const handlers = makeMoveHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer"), driveFor: storageFor, origin: appBaseUrl });

export const POST = handlers.openCopy;
