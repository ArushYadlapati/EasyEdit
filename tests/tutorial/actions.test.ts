import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { markTutorialSeenAction } from "@/app/(dashboard)/tutorial/actions";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { hasSeenTutorial } from "@/lib/tutorial/seen";
import { makeSuiteDb, makeTestDb } from "../helpers/db";

const { signedIn, revalidatePath } = vi.hoisted(() => ({ signedIn: { user: null as CurrentUser | null }, revalidatePath: vi.fn() }));
let testDb: DB;
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: () => testDb }));
vi.mock("@/lib/access", () => ({ requireUser: vi.fn(async () => signedIn.user!) }));
vi.mock("next/cache", () => ({ revalidatePath }));

const ada: CurrentUser = { id: "u-ada", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "viewer" };
const vic: CurrentUser = { id: "u-vic", email: "vic@gmail.com", name: "Vic", image: null, allowlistRole: "editor" };

beforeAll(async () => {
  await (await makeSuiteDb()).close();
}, 120_000);

beforeEach(async () => {
  revalidatePath.mockClear();
  signedIn.user = ada;
  testDb = await makeTestDb();
  await testDb.insert(user).values([
    { id: ada.id, name: ada.name, email: ada.email },
    { id: vic.id, name: vic.name, email: vic.email },
  ]);
});

describe("the tutorial's action", () => {
  it("marks the tutorial seen for the signed-in person only, whatever their role", async () => {
    expect(await markTutorialSeenAction()).toEqual({});
    expect(await hasSeenTutorial(testDb, ada.id)).toBe(true);
    expect(await hasSeenTutorial(testDb, vic.id)).toBe(false);
  });

  it("has the dashboard's frame drawn afresh, so a page kept from before the mark does not welcome the person again", async () => {
    await markTutorialSeenAction();
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("can be sent twice, as two tabs closing the dialog would", async () => {
    expect(await markTutorialSeenAction()).toEqual({});
    expect(await markTutorialSeenAction()).toEqual({});
    expect(await hasSeenTutorial(testDb, ada.id)).toBe(true);
  });
});
