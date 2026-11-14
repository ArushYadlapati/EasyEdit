import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { makeProjectHandlers } from "@/lib/projects/handlers";

const handlers = makeProjectHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer") });

export const POST = handlers.presence;
export const DELETE = handlers.leave;
