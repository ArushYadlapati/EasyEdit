import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { makeStyleHandlers } from "@/lib/style/handlers";

const handlers = makeStyleHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer") });

export const GET = handlers.get;
export const PATCH = handlers.patch;
