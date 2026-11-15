import { afterEach, describe, expect, it, vi } from "vitest";
import { hasStorage } from "@/lib/spaces/storage";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete (globalThis as { __easyEditDrive?: unknown }).__easyEditDrive;
});

describe("hasStorage", () => {
  it("is false for a key that cannot be read, and logs one line without the key", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", '{"type":"service_account"}'); // the JSON itself, not base64
    vi.stubEnv("DRIVE_FOLDER_ID", "folder1");
    expect(hasStorage(SEED_TEAM_ID)).toBe(false);
    expect(log.mock.calls).toEqual([["Drive settings could not be read"]]);
  });

  it("is false for a space other than Seattle Solvers, even with a good key", () => {
    const { privateKey } = { privateKey: "x" };
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", Buffer.from(JSON.stringify({ type: "service_account", client_email: "a@b.c", private_key: privateKey })).toString("base64"));
    vi.stubEnv("DRIVE_FOLDER_ID", "folder1");
    expect(hasStorage(personalSpaceId("u1"))).toBe(false);
    expect(hasStorage(SEED_TEAM_ID)).toBe(true);
  });

  it("uses the lookup it is given", () => {
    expect(hasStorage("s", () => null)).toBe(false);
    expect(hasStorage("s", () => ({}) as never)).toBe(true);
  });
});
