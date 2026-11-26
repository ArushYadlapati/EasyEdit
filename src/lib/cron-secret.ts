import { createHash, timingSafeEqual } from "node:crypto";

const sameSecret = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

// Whether a request is one of the server's scheduled jobs (vercel.json crons): Vercel sends them with
// `Authorization: Bearer <CRON_SECRET>`. With no CRON_SECRET set, no request is.
export function isCronCall(req: Request, secret: string | undefined): boolean {
  return !!secret && sameSecret(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}
