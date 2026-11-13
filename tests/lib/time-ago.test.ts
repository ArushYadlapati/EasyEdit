import { expect, it } from "vitest";
import { timeAgo } from "@/lib/time-ago";

const now = new Date("2026-11-13T12:00:00Z");
const before = (seconds: number) => new Date(now.getTime() - seconds * 1000);
const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

it("says how long ago, long or short", () => {
  const cases: [seconds: number, long: string, short: string][] = [
    [5, "just now", "just now"],
    [30, "30 seconds ago", "30 sec ago"],
    [MIN, "1 minute ago", "1 min ago"],
    [5 * MIN, "5 minutes ago", "5 min ago"],
    [HOUR, "1 hour ago", "1 hr ago"],
    [3 * HOUR, "3 hours ago", "3 hr ago"],
    [DAY, "1 day ago", "1 day ago"],
    [2 * DAY, "2 days ago", "2 days ago"],
    [14 * DAY, "2 weeks ago", "2 wk ago"],
    [60 * DAY, "1 month ago", "1 mo ago"],
    [61 * DAY, "2 months ago", "2 mo ago"],
    [800 * DAY, "2 years ago", "2 yr ago"],
    [-60, "just now", "just now"],
  ];
  for (const [seconds, long, short] of cases) {
    expect(timeAgo(before(seconds), now), `${seconds}s long`).toBe(long);
    expect(timeAgo(before(seconds), now, "long"), `${seconds}s long, named`).toBe(long);
    expect(timeAgo(before(seconds), now, "short"), `${seconds}s short`).toBe(short);
  }
});
