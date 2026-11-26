import { getDb } from "@/db";
import { requireUserApi } from "@/lib/access";
import { makeReviewHandlers } from "@/lib/review/handlers";

const handlers = makeReviewHandlers({ db: getDb, auth: (req) => requireUserApi(req, "viewer") });

export const GET = handlers.comments;
export const POST = handlers.addComment;
