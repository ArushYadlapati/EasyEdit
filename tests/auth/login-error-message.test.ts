import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "@/lib/login-error-message";

const NOT_ALLOWLISTED = "This Google account isn't on the Seattle Solvers allowlist. Ask an admin to add you.";
const DID_NOT_FINISH =
  "Sign-in didn't finish. Try again. If it keeps happening, ask an admin to check that you're on the allowlist.";

describe("loginErrorMessage", () => {
  it("shows nothing without an error", () => {
    expect(loginErrorMessage(undefined)).toBeNull();
    expect(loginErrorMessage("")).toBeNull();
  });

  it("shows the allowlist message for NOT_ALLOWLISTED in any case", () => {
    expect(loginErrorMessage("NOT_ALLOWLISTED")).toBe(NOT_ALLOWLISTED);
    expect(loginErrorMessage("not_allowlisted")).toBe(NOT_ALLOWLISTED);
    expect(loginErrorMessage("Not_Allowlisted")).toBe(NOT_ALLOWLISTED);
  });

  it("shows a generic message for any other error", () => {
    expect(loginErrorMessage("access_denied")).toBe(DID_NOT_FINISH);
    expect(loginErrorMessage("internal_server_error")).toBe(DID_NOT_FINISH);
    expect(loginErrorMessage("unable_to_create_user")).toBe(DID_NOT_FINISH);
  });
});

describe("loginErrorMessage with open sign-up", () => {
  // With sign-up open, the hook refuses only a Google account whose email Google hasn't verified.
  const UNVERIFIED = "Google hasn't verified that email address, so EasyEdit can't use it to sign in.";

  it("says Google hasn't verified the email, never the allowlist", () => {
    expect(loginErrorMessage("NOT_ALLOWLISTED", true)).toBe(UNVERIFIED);
    expect(loginErrorMessage("not_allowlisted", true)).toBe(UNVERIFIED);
    expect(loginErrorMessage("access_denied", true)).toBe("Sign-in didn't finish. Try again.");
    expect(loginErrorMessage(undefined, true)).toBeNull();
  });

  it("keeps today's wording with it off", () => {
    expect(loginErrorMessage("NOT_ALLOWLISTED", false)).toBe(NOT_ALLOWLISTED);
    expect(loginErrorMessage("access_denied", false)).toBe(DID_NOT_FINISH);
  });
});
