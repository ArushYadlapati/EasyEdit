import { getDb } from "@/db";
import { socialConfig } from "@/lib/social/config";
import { cleanUpStyles, makeStyleTrimCron } from "@/lib/style/trim-cron";

// Vercel runs this once a day (vercel.json crons) with the CRON_SECRET, so nothing a style kept from a YouTube channel
// outlasts YouTube's 30 days or EasyEdit's access to the channel by more than a day, and nothing is kept from a video
// or project that is gone; see src/lib/style/trim-cron.ts.
const handler = makeStyleTrimCron({ env: process.env, clean: () => cleanUpStyles(getDb(), socialConfig()) });

export const dynamic = "force-dynamic";
export const GET = handler;
