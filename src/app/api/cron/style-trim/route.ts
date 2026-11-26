import { getDb } from "@/db";
import { trimStaleChannelReferences } from "@/lib/style/service";
import { makeStyleTrimCron } from "@/lib/style/trim-cron";

// Vercel runs this once a day (vercel.json crons) with the CRON_SECRET, so nothing a style kept from a YouTube channel
// outlasts YouTube's 30 days; see src/lib/style/trim-cron.ts.
const handler = makeStyleTrimCron({ env: process.env, trim: () => trimStaleChannelReferences(getDb()) });

export const dynamic = "force-dynamic";
export const GET = handler;
