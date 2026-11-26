import "server-only";
import type { CurrentUser } from "@/lib/access-rules";
import { apiRoute } from "@/lib/api-route";
import { ServiceError } from "@/lib/service-error";
import { readSearch, searchUrl } from "./pexels";
import { STOCK_MESSAGES, STOCK_PAGES, STOCK_QUERY_CHARS, type StockKind, type StockResult } from "./types";

export type StockHandlerDeps = {
  auth: (req: Request) => Promise<CurrentUser | Response>;
  config: () => { key: string } | null;
  fetch?: typeof fetch;
};

const TIMEOUT_MS = 10_000;

export function makeStockHandlers(deps: StockHandlerDeps) {
  return {
    // GET /api/stock?kind=video|image&q=<words>&page=<n>: a page of a search of Pexels, for a signed-in person. Only
    // the words and the page go to Pexels: nothing about who asks. Never an error for a server without a key: the
    // editor just shows no stock library.
    search: apiRoute(async (req: Request): Promise<Response> => {
      const user = await deps.auth(req);
      if (user instanceof Response) return user;
      const config = deps.config();
      if (!config) return Response.json({ on: false } satisfies StockResult, { headers: { "cache-control": "no-store" } });
      const params = new URL(req.url).searchParams;
      const kind = params.get("kind");
      if (kind !== "video" && kind !== "image") throw new ServiceError("INVALID", 400, "kind must be video or image");
      const query = (params.get("q") ?? "").trim();
      if (query.length > STOCK_QUERY_CHARS) throw new ServiceError("INVALID", 400, `q must be at most ${STOCK_QUERY_CHARS} characters`);
      const page = Number(params.get("page") ?? "1");
      if (!Number.isInteger(page) || page < 1 || page > STOCK_PAGES) throw new ServiceError("INVALID", 400, `page must be a whole number from 1 to ${STOCK_PAGES}`);

      let answer: Response;
      try {
        answer = await (deps.fetch ?? fetch)(searchUrl(kind as StockKind, query, page), { headers: { authorization: config.key }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new ServiceError("PLATFORM_REFUSED", 502, STOCK_MESSAGES.failed);
      }
      if (answer.status === 429) throw new ServiceError("PLATFORM_REFUSED", 429, STOCK_MESSAGES.busy);
      if (!answer.ok) throw new ServiceError("PLATFORM_REFUSED", 502, STOCK_MESSAGES.failed);
      const found = readSearch(kind, await answer.json().catch(() => null));
      // The same search again within ten minutes is answered by the browser's own copy: Pexels counts every request.
      return Response.json({ on: true, ...found } satisfies StockResult, { headers: { "cache-control": "private, max-age=600" } });
    }),
  };
}
