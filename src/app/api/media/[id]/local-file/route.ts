import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { appBaseUrl } from "@/lib/connector/config";
import { readerFor, storageFor } from "@/lib/spaces/storage";
import { makeMediaHandlers } from "@/lib/media/handlers";

const handlers = makeMediaHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer"), drive: storageFor, reader: readerFor, origin: appBaseUrl });

export const POST = handlers.localFile;
