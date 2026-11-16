import { makeDbSizeCron, neonStorage, sendPush } from "@/lib/db-size-alert";

// Vercel runs this once a day (vercel.json crons) with the CRON_SECRET; see src/lib/db-size-alert.ts.
const handler = makeDbSizeCron({
  env: process.env,
  measure: (apiKey, projectId) => neonStorage(apiKey, projectId),
  push: (topic, note) => sendPush(topic, note),
});

export const dynamic = "force-dynamic";
export const GET = handler;
