import { isCronCall } from "@/lib/cron-secret";

// Neon's Free plan caps a project's storage at 1 GB, counted as the logical size of all its branches together, and
// sends no warning: at the cap every save fails (nothing is deleted), so saving stops for everyone. A daily check
// (vercel.json crons → /api/cron/db-size) reads Neon's own per-branch sizes and pushes a note to the owner's phone
// through ntfy once the total passes these sizes, every day it stays past them.
const MB = 1024 * 1024;
export const STORAGE_CAP_BYTES = 1024 * MB;
export const DB_SIZE_THRESHOLDS = { warnBytes: 500 * MB, urgentBytes: 800 * MB } as const;
const CALL_TIMEOUT_MS = 10_000;

export type Push = { title: string; message: string; priority: "default" | "urgent" };
export type SizeLevel = "ok" | "warn" | "urgent";
export type Storage = { totalBytes: number; branches: { name: string; bytes: number }[] };
export type SizeCheck = { bytes: number; level: SizeLevel; pushed: boolean };

const mb = (bytes: number) => `${Math.round(bytes / MB)} MB`;

const levelOf = (bytes: number): SizeLevel =>
  bytes >= DB_SIZE_THRESHOLDS.urgentBytes ? "urgent" : bytes >= DB_SIZE_THRESHOLDS.warnBytes ? "warn" : "ok";

// The two biggest branches, so the owner can tell a stale test branch from production growing.
const biggest = (storage: Storage) =>
  [...storage.branches]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 2)
    .map((branch) => `${branch.name} ${mb(branch.bytes)}`)
    .join(", ");

const usageLine = (storage: Storage) =>
  `EasyEdit's database storage is ${mb(storage.totalBytes)} of the Free plan's 1 GB, all branches together (biggest: ${biggest(storage)}).`;

// Reads the storage and pushes when it is past a threshold, or always on a test run.
export async function checkDatabaseSize(deps: { measure: () => Promise<Storage>; push: (note: Push) => Promise<void>; test?: boolean }): Promise<SizeCheck> {
  const storage = await deps.measure();
  const bytes = storage.totalBytes;
  const level = levelOf(bytes);
  if (deps.test) {
    await deps.push({
      title: "EasyEdit size alert: test",
      message: `${usageLine(storage)} Alerts come at ${mb(DB_SIZE_THRESHOLDS.warnBytes)} and ${mb(DB_SIZE_THRESHOLDS.urgentBytes)}.`,
      priority: "default",
    });
    return { bytes, level, pushed: true };
  }
  if (level === "ok") return { bytes, level, pushed: false };
  await deps.push({
    title: `EasyEdit database at ${mb(bytes)}`,
    message: `${usageLine(storage)} At 1 GB, saving stops for everyone until space is freed or the plan is upgraded.`,
    priority: level === "urgent" ? "urgent" : "default",
  });
  return { bytes, level, pushed: true };
}

// Neon's per-branch logical sizes for the project (GET /projects/{id}/branches), summed. The key is limited to this
// one project. A missing or non-numeric size is an error, never read as 0, so a broken answer can't look "ok".
export async function neonStorage(apiKey: string, projectId: string, fetchFn: typeof fetch = fetch): Promise<Storage> {
  const answer = await fetchFn(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!answer.ok) throw new Error(`Neon answered ${answer.status}`);
  const body: unknown = await answer.json();
  const list = typeof body === "object" && body !== null && Array.isArray((body as { branches?: unknown }).branches) ? (body as { branches: unknown[] }).branches : null;
  if (!list || list.length === 0) throw new Error("Neon's answer had no branches");
  const branches = list.map((raw) => {
    const branch = raw as { name?: unknown; logical_size?: unknown };
    const bytes = Number(branch.logical_size);
    if (typeof branch.name !== "string" || !Number.isFinite(bytes) || bytes < 0) throw new Error("Neon's answer had a branch without a size");
    return { name: branch.name, bytes };
  });
  return { totalBytes: branches.reduce((sum, branch) => sum + branch.bytes, 0), branches };
}

// One ntfy push. The topic name is the only secret (anyone who knows it can read or post to it), so it lives in a
// server setting and is never logged.
export async function sendPush(topic: string, note: Push, fetchFn: typeof fetch = fetch): Promise<void> {
  const answer = await fetchFn(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers: { Title: note.title, Priority: note.priority, Tags: note.priority === "urgent" ? "warning" : "floppy_disk" },
    body: note.message,
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!answer.ok) throw new Error(`ntfy answered ${answer.status}`);
}

const REQUIRED = ["NTFY_TOPIC", "NEON_API_KEY", "NEON_PROJECT_ID"] as const;

// The cron route's handler. Vercel calls it with `Authorization: Bearer <CRON_SECRET>`; anything else is refused, and
// with no CRON_SECRET set every request is refused. `?test=1` (with the secret) sends a test push.
export function makeDbSizeCron(deps: {
  env: Record<string, string | undefined>;
  measure: (apiKey: string, projectId: string) => Promise<Storage>;
  push: (topic: string, note: Push) => Promise<void>;
}) {
  return async (req: Request): Promise<Response> => {
    if (!isCronCall(req, deps.env.CRON_SECRET)) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const missing = REQUIRED.filter((name) => !deps.env[name]);
    if (missing.length > 0) {
      const error = `Not set: ${missing.join(", ")}.`;
      console.error(`Database size check: ${error}`);
      return Response.json({ error }, { status: 500 });
    }
    const { NTFY_TOPIC: topic, NEON_API_KEY: apiKey, NEON_PROJECT_ID: projectId } = deps.env as Record<(typeof REQUIRED)[number], string>;
    const result = await checkDatabaseSize({
      measure: () => deps.measure(apiKey, projectId),
      push: (note) => deps.push(topic, note),
      test: new URL(req.url).searchParams.get("test") === "1",
    });
    return Response.json(result);
  };
}
