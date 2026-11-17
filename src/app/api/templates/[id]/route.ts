import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { makeTemplateHandlers } from "@/lib/templates/handlers";

const handlers = makeTemplateHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer") });

export const GET = handlers.get;
export const PATCH = handlers.update;
export const DELETE = handlers.remove;
