import { describe, expect, it, vi } from "vitest";
import type { ApiResult, ProjectApi } from "@/lib/editor/api";
import { MESSAGES } from "@/lib/editor/messages";
import { renameFromEditor } from "@/lib/editor/project-name";
import { makeStore } from "./fixtures";

type RenameResult = ApiResult<{ name: string }>;

// A ProjectApi whose rename answers each call from `answer`; everything else fails as if offline.
function fakeApi(answer: (name: string) => Promise<RenameResult>) {
  const rename = vi.fn(answer);
  const api: ProjectApi = {
    postOps: async () => ({ ok: false, kind: "network" }),
    getVersion: async () => ({ ok: false, kind: "network" }),
    getOpsSince: async () => ({ ok: false, kind: "network" }),
    getProject: async () => ({ ok: false, kind: "network" }),
    rename,
  };
  return { api, rename };
}

// A promise and the function that settles it.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("renameFromEditor", () => {
  it("shows the new name at once and then the server's", async () => {
    const store = makeStore();
    const st = () => store.getState();
    const answer = deferred<RenameResult>();
    const { api, rename } = fakeApi(() => answer.promise);
    const done = renameFromEditor(store, api, "  Finals  ");
    expect(st().name).toBe("Finals");
    expect(rename).toHaveBeenCalledWith("Finals");
    answer.resolve({ ok: true, name: "Finals" });
    await expect(done).resolves.toBe(true);
    expect(st().name).toBe("Finals");
    expect(st().notice).toBeNull();
  });

  it("takes the name the server answers with", async () => {
    const store = makeStore();
    const { api } = fakeApi(async () => ({ ok: true, name: "Finals day" }));
    await expect(renameFromEditor(store, api, "Finals")).resolves.toBe(true);
    expect(store.getState().name).toBe("Finals day");
  });

  it("a refusal puts the old name back and says why", async () => {
    const store = makeStore();
    const { api } = fakeApi(async () => ({ ok: false, kind: "op", code: "INVALID", message: "Enter a name up to 100 characters." }));
    await expect(renameFromEditor(store, api, "Finals")).resolves.toBe(false);
    expect(store.getState().name).toBe("Qual recap");
    expect(store.getState().notice?.text).toBe("Enter a name up to 100 characters.");
  });

  it("a network failure says the rename failed", async () => {
    const store = makeStore();
    const { api } = fakeApi(async () => ({ ok: false, kind: "network" }));
    await renameFromEditor(store, api, "Finals");
    expect(store.getState().name).toBe("Qual recap");
    expect(store.getState().notice?.text).toBe(MESSAGES.renameFailed);
  });

  it("a forbidden answer says the access is view-only", async () => {
    const store = makeStore();
    const { api } = fakeApi(async () => ({ ok: false, kind: "forbidden" }));
    await renameFromEditor(store, api, "Finals");
    expect(store.getState().name).toBe("Qual recap");
    expect(store.getState().notice?.text).toBe(MESSAGES.readOnly);
  });

  it("does nothing for an empty or unchanged name, a viewer or a deleted project", async () => {
    const store = makeStore();
    const { api, rename } = fakeApi(async (name) => ({ ok: true, name }));
    for (const typed of ["", "   ", "Qual recap", "  Qual recap "]) {
      await expect(renameFromEditor(store, api, typed)).resolves.toBe(false);
    }
    await expect(renameFromEditor(makeStore({ canEdit: false }), api, "Finals")).resolves.toBe(false);
    const deleted = makeStore();
    deleted.getState().setStatus("deleted");
    await expect(renameFromEditor(deleted, api, "Finals")).resolves.toBe(false);
    expect(rename).not.toHaveBeenCalled();
    expect(store.getState().name).toBe("Qual recap");
    expect(deleted.getState().name).toBe("Qual recap");
  });

  it("a late failure never undoes a newer rename", async () => {
    const store = makeStore();
    const first = deferred<RenameResult>();
    const { api } = fakeApi((name) => (name === "A" ? first.promise : Promise.resolve({ ok: true, name })));
    const a = renameFromEditor(store, api, "A");
    await expect(renameFromEditor(store, api, "B")).resolves.toBe(true);
    first.resolve({ ok: false, kind: "network" });
    await a;
    expect(store.getState().name).toBe("B");
  });

  it("a late answer never replaces a newer rename", async () => {
    const store = makeStore();
    const first = deferred<RenameResult>();
    const { api } = fakeApi((name) => (name === "A" ? first.promise : Promise.resolve({ ok: true, name })));
    const a = renameFromEditor(store, api, "A");
    await renameFromEditor(store, api, "B");
    first.resolve({ ok: true, name: "A" });
    await a;
    expect(store.getState().name).toBe("B");
  });
});
