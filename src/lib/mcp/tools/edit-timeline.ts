import { formatFields, type OpInput } from "@/lib/timeline";
import { editedText, runEdit } from "../edit";
import { assetNotUsable, opNotAvailable } from "../errors";
import { checkAllowedOps, checkAssetOps } from "../op-rules";
import { ok, type ToolContext, type ToolResult } from "../types";

// A custom size equal to a named size is that named size, as everywhere else.
function namedSize(op: unknown): unknown {
  if (typeof op !== "object" || op === null) return op;
  const { width, height, ...rest } = op as Record<string, unknown>;
  if (rest.op !== "set_format" || rest.format !== "custom" || typeof width !== "number" || typeof height !== "number") return op;
  const fields = formatFields({ width, height });
  return fields.format === "custom" ? op : { ...rest, ...fields };
}

export async function editTimelineTool(
  ctx: ToolContext,
  input: { project_id: string; expected_version: number; ops: unknown[] },
): Promise<ToolResult> {
  const notAllowed = checkAllowedOps(input.ops);
  if (notAllowed) return opNotAvailable(notAllowed);
  // Before the project is read: an asset id that is wrong says how to find the right one.
  const badAsset = await checkAssetOps(ctx.db, input.ops);
  if (badAsset) return assetNotUsable(badAsset);

  // The engine checks each op's shape; the service refuses the whole batch if one is wrong.
  const done = await runEdit(ctx, {
    projectId: input.project_id,
    expectedVersion: input.expected_version,
    ops: input.ops.map(namedSize) as OpInput[],
    key: input.ops,
  });
  if (!done.ok) return done.result;
  const n = done.applied.ops.length;
  return ok(editedText(ctx, `Applied ${n} ${n === 1 ? "op" : "ops"} as version ${done.applied.version}.`, done));
}
