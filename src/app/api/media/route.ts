import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { appBaseUrl } from "@/lib/connector/config";
import { storageFor } from "@/lib/spaces/storage";
import { makeMediaHandlers } from "@/lib/media/handlers";

const handlers = makeMediaHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer"), drive: storageFor, origin: appBaseUrl });

export const GET = handlers.list;
export const POST = handlers.open;
