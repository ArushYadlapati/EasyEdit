import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { socialConfig } from "@/lib/social/config";
import { makePostHandlers } from "@/lib/social/post-handlers";

const handlers = makePostHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer"), config: () => socialConfig() });

export const POST = handlers.finish;
