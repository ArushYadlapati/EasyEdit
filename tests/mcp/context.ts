import type { DB } from "@/db";
import { user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { claudeActorFor, type Actor } from "@/lib/actor";
import type { Role } from "@/lib/allowlist/service";
import { LIMITS, type Limits } from "@/lib/limits";
import type { ToolContext } from "@/lib/mcp/types";
import { applyProjectOps } from "@/lib/projects/service";
import { listMySpaces } from "@/lib/spaces/service";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import type { OpInput } from "@/lib/timeline";
import { joinSpace } from "../helpers/actor";

// A tool context that also holds the Seattle Solvers actor, for tests that call the services around the tools.
export type TestToolContext = ToolContext & { actor: Actor };

// A tool context for a member "u1" (or another id) of Seattle Solvers and of their own personal space, whose user row
// exists so names resolve. `actor` is the agent's actor in Seattle Solvers.
export async function toolContext(db: DB, over: { id?: string; name?: string; role?: Role; limits?: Partial<Limits> } = {}): Promise<TestToolContext> {
  const id = over.id ?? "u1";
  const role = over.role ?? "editor";
  const me: CurrentUser = { id, email: `${id}@gmail.com`, name: over.name ?? "Ada Lovelace", image: null, allowlistRole: role };
  await db.insert(user).values({ id, name: me.name, email: me.email, emailVerified: true }).onConflictDoNothing();
  await joinSpace(db, me, role);
  await joinSpace(db, me, "admin", personalSpaceId(id));
  const spaces = await listMySpaces(db, id);
  return { db, user: me, agent: "claude", spaces, actor: claudeActorFor(me, { spaceId: SEED_TEAM_ID, role }), baseUrl: "https://studio.test", limits: { ...LIMITS, ...over.limits }, now: () => new Date() };
}

export const textClip = (start: number, text = "GO SOLVERS", extra: Record<string, unknown> = {}) => ({
  type: "text", start, duration: 30, text,
  transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, fit: "contain" },
  style: { fontFamily: "Geist", fontSize: 96, fontWeight: 700, color: "#ffffff", align: "center" },
  ...extra,
});
export const addText = (start: number, text?: string, extra?: Record<string, unknown>) => ({ op: "add_clip", trackId: "t1", clip: textClip(start, text, extra) });

// Fills track t1 with `count` back-to-back text clips k0, k1, … in batches of 500. Returns the version reached.
export async function fillWithText(db: DB, actor: Actor, projectId: string, count: number): Promise<number> {
  let version = 0;
  for (let from = 0; from < count; from += 500, version++) {
    const ops = Array.from({ length: Math.min(500, count - from) }, (_, i) => addText((from + i) * 30, `Line ${from + i}`, { id: `k${from + i}` }));
    await applyProjectOps(db, actor, { projectId, baseVersion: version, ops: ops as OpInput[] });
  }
  return version;
}
