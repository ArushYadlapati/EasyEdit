import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { storageConfig } from "@/lib/storage/config";
import { makeConnectHandlers } from "@/lib/storage/connect-handlers";
import { setUpStorage } from "@/lib/storage/setup";

const handlers = makeConnectHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer"), config: () => storageConfig(), setUp: setUpStorage });

export const GET = handlers.callback;
