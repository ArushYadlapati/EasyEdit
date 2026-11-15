export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

// A team's address from its name: lowercase a-z0-9 and hyphens, runs collapsed, no hyphen at either end, at most 40
// characters. A name with nothing usable in it (an emoji, say) is "team"; one that leaves under 3 characters gets "-team".
export function slugFromName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  if (base === "") return "team";
  return base.length < SLUG_MIN ? `${base}-team` : base;
}

// Addresses a team may never take: they belong to the app's own routes or to personal spaces.
export function isReservedSlug(slug: string): boolean {
  const s = slug.toLowerCase();
  return s === "personal" || s.startsWith("personal_") || s === "settings" || s === "new" || s === "api";
}

// The slug with a numeric suffix (-2, -3 …), the base shortened so the whole stays within 40 characters.
export function withSuffix(slug: string, n: number): string {
  if (n <= 1) return slug;
  const tail = `-${n}`;
  return `${slug.slice(0, SLUG_MAX - tail.length).replace(/-+$/, "")}${tail}`;
}
