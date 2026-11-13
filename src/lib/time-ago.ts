// [below, seconds per unit, long name, short name]
const UNITS: [limit: number, seconds: number, long: string, short: string][] = [
  [60, 1, "second", "sec"],
  [3600, 60, "minute", "min"],
  [86400, 3600, "hour", "hr"],
  [604800, 86400, "day", "day"],
  [2629800, 604800, "week", "wk"],
  [31557600, 2629800, "month", "mo"],
  [Infinity, 31557600, "year", "yr"],
];

// "5 minutes ago", or "5 min ago" in the short style, where only "day" takes an s.
export function timeAgo(date: Date, now: Date = new Date(), style: "long" | "short" = "long"): string {
  const elapsed = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (elapsed < 10) return "just now";
  for (const [limit, seconds, long, short] of UNITS) {
    if (elapsed < limit) {
      const count = Math.floor(elapsed / seconds);
      const plural = count !== 1 && (style === "long" || short === "day");
      return `${count} ${style === "long" ? long : short}${plural ? "s" : ""} ago`;
    }
  }
  return "just now";
}
