import type { DB } from "@/db";
import { isCronCall } from "@/lib/cron-secret";
import type { SocialConfig } from "@/lib/social/config";
import { checkChannelAccess } from "@/lib/social/connections";
import { dropUnconnectedChannelReferences } from "./channel-references";
import { dropGoneReferences, trimStaleChannelReferences } from "./service";

// What one day's clean-up of the styles did: how many channel videos were cut back to their address, how many
// references were deleted because what they came from is gone, and how many channels Google said EasyEdit may no
// longer read (what the style kept from each of those was deleted too).
export type StyleCleanUp = { trimmed: number; dropped: number; channelsGone: number };

// The daily clean-up of the styles, in every space. First, facts read from a channel more than 30 days ago are cut
// back to the video's address: YouTube asks for that, so nothing slower comes before it. Then each channel a style
// keeps videos from is checked with Google (on a server with YouTube set up): one whose access Google ended takes its
// videos with it. Last, videos from a channel the space no longer has, and references to a video removed from the
// library or a deleted project, are deleted, which also catches any a failed check left. No role check: it is
// nobody's change.
export async function cleanUpStyles(db: DB, cfg: SocialConfig | null, fetchFn: typeof fetch = fetch, now: Date = new Date()): Promise<StyleCleanUp> {
  const trimmed = await trimStaleChannelReferences(db, now);
  const channelsGone = cfg ? await checkChannelAccess(db, cfg, fetchFn) : 0;
  const dropped = (await dropUnconnectedChannelReferences(db)) + (await dropGoneReferences(db));
  return { trimmed, dropped, channelsGone };
}

// The daily clean-up's route (vercel.json crons → /api/cron/style-trim): it runs cleanUpStyles. Anything but
// Vercel's scheduled call, with the CRON_SECRET, is refused, and with no CRON_SECRET set every request is. Answers
// what the clean-up did.
export function makeStyleTrimCron(deps: { env: Record<string, string | undefined>; clean: () => Promise<StyleCleanUp> }) {
  return async (req: Request): Promise<Response> => {
    if (!isCronCall(req, deps.env.CRON_SECRET)) return Response.json({ error: "Unauthorized" }, { status: 401 });
    return Response.json(await deps.clean());
  };
}
