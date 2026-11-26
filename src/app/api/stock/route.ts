import { requireUserApi } from "@/lib/access";
import { stockConfig } from "@/lib/stock/config";
import { makeStockHandlers } from "@/lib/stock/handlers";

const handlers = makeStockHandlers({ auth: (req) => requireUserApi(req, "viewer"), config: () => stockConfig() });

export const GET = handlers.search;
