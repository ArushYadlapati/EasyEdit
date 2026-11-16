import { afterEach, describe, expect, it, vi } from "vitest";
import { inviteUrl } from "@/lib/spaces/invite-link";

afterEach(() => vi.unstubAllEnvs());

describe("inviteUrl", () => {
  it("is the app's origin plus /invite/<id>, whatever trailing path or slash the setting has", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://easyedit.test/");
    expect(inviteUrl("abc123")).toBe("https://easyedit.test/invite/abc123");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000/some/path");
    expect(inviteUrl("x")).toBe("http://localhost:3000/invite/x");
  });
});
