import { describe, expect, it, vi } from "vitest";
import * as serverActions from "@/app/(dashboard)/dashboard/actions";

type Action = (...args: unknown[]) => Promise<object>;

const { spies, built, makeDashboardActions, revalidatePath, redirect, getDb, requireUser } = vi.hoisted(() => {
  const spies = {
    create: vi.fn<Action>(async () => ({})),
    rename: vi.fn<Action>(async () => ({})),
    remove: vi.fn<Action>(async () => ({})),
    duplicate: vi.fn<Action>(async () => ({})),
    move: vi.fn<Action>(async () => ({})),
    createFolder: vi.fn<Action>(async () => ({})),
    renameFolder: vi.fn<Action>(async () => ({})),
    deleteFolder: vi.fn<Action>(async () => ({})),
  };
  const built: unknown[] = []; // what the module built its actions from, kept here since mock calls are cleared before each test
  return {
    spies,
    built,
    makeDashboardActions: (deps: unknown) => {
      built.push(deps);
      return spies;
    },
    revalidatePath: vi.fn(),
    redirect: vi.fn(),
    getDb: vi.fn(),
    requireUser: vi.fn(),
  };
});
vi.mock("@/lib/projects/dashboard-actions", () => ({ makeDashboardActions }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/db", () => ({ getDb }));
vi.mock("@/lib/access", () => ({ requireUser }));

// Each server action and the action it must call.
const CALLS: [keyof typeof serverActions, keyof typeof spies][] = [
  ["createProjectAction", "create"],
  ["renameProjectAction", "rename"],
  ["deleteProjectAction", "remove"],
  ["duplicateProjectAction", "duplicate"],
  ["moveProjectAction", "move"],
  ["createFolderAction", "createFolder"],
  ["renameFolderAction", "renameFolder"],
  ["deleteFolderAction", "deleteFolder"],
];

describe("the dashboard's server actions", () => {
  it("each server action calls its own action", async () => {
    expect(built).toEqual([{ db: getDb, requireUser, revalidate: revalidatePath, redirect }]);
    expect(Object.keys(serverActions).sort()).toEqual(CALLS.map(([name]) => name).sort());
    for (const [name, key] of CALLS) {
      const formData = new FormData();
      formData.set("id", name);
      if (name === "createProjectAction") {
        const prev = { error: "earlier" };
        await serverActions.createProjectAction("space_1", prev, formData);
        expect(spies.create).toHaveBeenCalledWith("space_1", prev, formData);
      } else {
        await (serverActions[name] as (spaceId: string, formData: FormData) => Promise<unknown>)("space_1", formData);
        expect(spies[key]).toHaveBeenCalledWith("space_1", formData);
      }
      for (const [other, spy] of Object.entries(spies)) {
        const received = spy.mock.calls.some((args: unknown[]) => args.includes(formData));
        expect([other, received]).toEqual([other, other === key]);
      }
    }
  });
});
