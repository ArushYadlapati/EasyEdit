import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { appBaseUrl } from "@/lib/connector/config";
import { readerFor, storageFor } from "@/lib/spaces/storage";
import { makeReadTokenHandler } from "@/lib/media/handlers";

export const POST = makeReadTokenHandler({ db: getDb, auth: (req) => requireUserApi(req, "viewer"), drive: storageFor, reader: readerFor, origin: appBaseUrl });
