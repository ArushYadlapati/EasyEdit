import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { makeBrandHandlers } from "@/lib/brand/handlers";

const handlers = makeBrandHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer") });

export const GET = handlers.get;
export const PATCH = handlers.patch;
