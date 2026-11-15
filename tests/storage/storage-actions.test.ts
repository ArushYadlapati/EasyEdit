import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { describe, expect, it, vi } from "vitest";
import { assets, spaceStorage } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { DriveError } from "@/lib/drive/token";
import { ServiceError } from "@/lib/service-error";
import { ConnectionBrokenError } from "@/lib/storage/google-oauth";
import { makeSetUpStorage, type SetUpStorage } from "@/lib/storage/setup";
import { makeStorageActions } from "@/lib/storage/storage-actions";
import { joinSpace } from "../helpers/actor";
import { type StorageWorld, storageWorld } from "../helpers/storage";

const u1: CurrentUser = { id: "u1", email: "u1@gmail.com", name: "U1", image: null, allowlistRole: null };
const u2: CurrentUser = { id: "u2", email: "u2@gmail.com", name: "U2", image: null, allowlistRole: null };

function actionsFor(w: StorageWorld, over: { user?: CurrentUser; setUp?: SetUpStorage } = {}) {
  const revalidate = vi.fn();
  const setUp = over.setUp ?? makeSetUpStorage({ config: w.cfg, mainSa: () => w.mainSa, fetch: w.fake.fetch });
  const actions = makeStorageActions({ db: () => w.db, requireUser: async () => over.user ?? u1, setUp, revalidate });
  return { actions, revalidate };
}

const form = (connectionId: string) => {
  const data = new FormData();
  data.set("connectionId", connectionId);
  return data;
};

describe("choosing an account the person already connected", () => {
  it("sets up the space's storage in it, with no new Google screen, and refreshes the pages", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ email: "ada@gmail.com" });
    const { actions, revalidate } = actionsFor(w);
    expect(await actions.choose(w.personal, form(ada.id))).toEqual({});
    const [row] = await w.db.select().from(spaceStorage).where(eq(spaceStorage.spaceId, w.personal));
    expect(row).toMatchObject({ kind: "google_account", connectionId: ada.id, folderName: "EasyEdit – Personal" });
    expect(revalidate).toHaveBeenCalled();
  });

  it("someone who doesn't run the space, or a connection that isn't theirs, changes nothing", async () => {
    const w = await storageWorld();
    await joinSpace(w.db, { id: "u2" }, "editor");
    const ada = await w.connect({ email: "ada@gmail.com" });
    const failed = { error: "That didn't work. Nothing was changed. Try again." };
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await actionsFor(w, { user: u2 }).actions.choose(w.personal, form(ada.id))).toEqual(failed);
      const theirs = await w.connect({ userId: "u2", email: "u2.drive@gmail.com" });
      expect(await actionsFor(w).actions.choose(w.personal, form(theirs.id))).toEqual(failed);
      expect(await actionsFor(w).actions.choose(w.personal, new FormData())).toEqual(failed);
    } finally {
      vi.restoreAllMocks();
    }
    expect(await w.db.select().from(spaceStorage).where(eq(spaceStorage.spaceId, w.personal))).toEqual([]);
  });

  it("a space that already holds uploads keeps its storage, and says so", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ email: "ada@gmail.com" });
    const other = await w.connect({ email: "ada.other@gmail.com" });
    const { actions } = actionsFor(w);
    await actions.choose(w.personal, form(ada.id));
    await w.db.insert(assets).values({ id: nanoid(12), spaceId: w.personal, kind: "video", name: "clip", fileName: "clip.mov", mimeType: "video/quicktime", sizeBytes: 1, lastModifiedMs: 1, uploadedBy: "u1" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await actions.choose(w.personal, form(other.id))).toEqual({ error: "This space already keeps files in Google Drive, so it can't move to another account yet." });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("each refusal and failure reads plainly", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ email: "ada@gmail.com" });
    const cases: [unknown, string][] = [
      [new ServiceError("TEAM_STORAGE_NOT_CONFIGURED", 409, "x"), "Team storage isn't set up on this server yet."],
      [new ServiceError("CONFLICT", 409, "x"), "Storage isn't set up on this server yet."],
      [new DriveError("files.create", 503, "backendError"), "That didn't work. Nothing was changed. Try again."],
      [new ConnectionBrokenError("revoked"), "Google ended EasyEdit's access to that account. Choose it again to reconnect it."],
    ];
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const [failure, message] of cases) {
        const setUp: SetUpStorage = async () => {
          throw failure;
        };
        expect(await actionsFor(w, { setUp }).actions.choose(w.personal, form(ada.id))).toEqual({ error: message });
      }
      // Anything else is a real fault and is not hidden.
      const setUp: SetUpStorage = async () => {
        throw new Error("boom");
      };
      await expect(actionsFor(w, { setUp }).actions.choose(w.personal, form(ada.id))).rejects.toThrow("boom");
    } finally {
      vi.restoreAllMocks();
    }
  });
});
