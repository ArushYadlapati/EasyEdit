// How long a new access token lasts. A token is a password an agent keeps, so it ends on its own unless the member
// chooses otherwise; 90 days is the default.
export const TOKEN_LIFETIMES = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: null, label: "No end date" },
] as const satisfies readonly { days: number | null; label: string }[];

export type TokenLifetime = (typeof TOKEN_LIFETIMES)[number]["days"];

export const DEFAULT_TOKEN_LIFETIME: TokenLifetime = 90;

export function isTokenLifetime(value: unknown): value is TokenLifetime {
  return TOKEN_LIFETIMES.some((choice) => choice.days === value);
}
