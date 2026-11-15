import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { storageConfig } from "@/lib/storage/config";
import { makeConnectHandlers } from "@/lib/storage/connect-handlers";
import { setUpNotReady } from "@/lib/storage/setup-types";

const handlers = makeConnectHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer"), config: () => storageConfig(), setUp: setUpNotReady });

export const GET = handlers.connect;
