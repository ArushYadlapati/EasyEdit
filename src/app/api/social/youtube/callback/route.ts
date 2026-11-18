import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { socialConfig } from "@/lib/social/config";
import { makeSocialConnectHandlers } from "@/lib/social/connect-handlers";

const handlers = makeSocialConnectHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer"), config: () => socialConfig() });

export const GET = handlers.callback;
