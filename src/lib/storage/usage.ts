import "server-only";
import type { AccessSource } from "@/lib/drive/token";
import type { DriveUsage } from "./messages";

const ABOUT = "https://www.googleapis.com/drive/v3/about?fields=storageQuota";

// A whole number of bytes from Google's answer, which sends them as strings; null for anything else.
function bytes(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

// How much of the Drive behind `source` is used, and its limit, from about.get. Only for showing: null on any failure
// (no token, no answer, a refusal, an answer of another shape), and the failure is not passed on.
export async function driveUsage(source: AccessSource, fetchFn: typeof fetch = fetch): Promise<DriveUsage | null> {
  try {
    const { accessToken } = await source.token();
    const response = await fetchFn(ABOUT, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const quota = typeof body === "object" && body !== null ? (body as { storageQuota?: Record<string, unknown> }).storageQuota : undefined;
    if (!quota) return null;
    const usedBytes = bytes(quota.usage);
    if (usedBytes === null) return null;
    if (quota.limit === undefined) return { usedBytes, limitBytes: null };
    const limitBytes = bytes(quota.limit);
    return limitBytes === null ? null : { usedBytes, limitBytes };
  } catch {
    return null;
  }
}
