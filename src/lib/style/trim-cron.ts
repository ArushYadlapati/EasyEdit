import { isCronCall } from "@/lib/cron-secret";

// The daily clean-up of what styles kept from YouTube channels (vercel.json crons → /api/cron/style-trim): facts read
// from a channel more than 30 days ago are cut back to the video's address (trimStaleChannelReferences). Anything but
// Vercel's scheduled call, with the CRON_SECRET, is refused, and with no CRON_SECRET set every request is. Answers how
// many videos were cut back.
export function makeStyleTrimCron(deps: { env: Record<string, string | undefined>; trim: () => Promise<number> }) {
  return async (req: Request): Promise<Response> => {
    if (!isCronCall(req, deps.env.CRON_SECRET)) return Response.json({ error: "Unauthorized" }, { status: 401 });
    return Response.json({ trimmed: await deps.trim() });
  };
}
