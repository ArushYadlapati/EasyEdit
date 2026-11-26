import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { makeStyleHandlers } from "@/lib/style/handlers";

const handlers = makeStyleHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer") });

export const GET = handlers.references;
export const POST = handlers.addReference;
