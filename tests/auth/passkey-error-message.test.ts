import { describe, expect, it } from "vitest";
import { passkeySignInErrorMessage } from "@/lib/passkey-error-message";

const NOT_ALLOWLISTED = "This account isn't on the Seattle Solvers allowlist. Ask an admin to add you.";
const NOT_SET_UP =
  "That passkey isn't set up for EasyEdit. Sign in with Google, then add a passkey from your account menu.";
const DID_NOT_FINISH = "Passkey sign-in didn't finish. Try again, or sign in with Google.";

// The shapes below are what `authClient.signIn.passkey()` really returns. A browser-side failure keeps
// SimpleWebAuthn's code but always carries the message "Auth cancelled"; a server refusal carries the server's code.
describe("passkeySignInErrorMessage", () => {
  it("shows nothing without an error", () => {
    expect(passkeySignInErrorMessage(null)).toBeNull();
  });

  it("shows nothing when the passkey sheet was cancelled or timed out", () => {
    // NotAllowedError (closed or timed out), passed through by SimpleWebAuthn.
    expect(passkeySignInErrorMessage({ code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", message: "Auth cancelled" })).toBeNull();
    // Aborted by the browser or by a newer ceremony.
    expect(passkeySignInErrorMessage({ code: "ERROR_CEREMONY_ABORTED", message: "Auth cancelled" })).toBeNull();
    // The plugin's own code for a browser error it couldn't name.
    expect(passkeySignInErrorMessage({ code: "AUTH_CANCELLED", message: "Auth cancelled" })).toBeNull();
    expect(
      passkeySignInErrorMessage({ message: "NotAllowedError: The operation either timed out or was not allowed." }),
    ).toBeNull();
  });

  it("shows the allowlist message when the account isn't allowed in", () => {
    expect(passkeySignInErrorMessage({ code: "NOT_ALLOWLISTED", message: "NOT_ALLOWLISTED" })).toBe(NOT_ALLOWLISTED);
  });

  it("says the passkey isn't set up when EasyEdit doesn't know it", () => {
    expect(passkeySignInErrorMessage({ code: "PASSKEY_NOT_FOUND", message: "Passkey not found" })).toBe(NOT_SET_UP);
    expect(passkeySignInErrorMessage({ code: "AUTHENTICATION_FAILED", message: "Authentication failed" })).toBe(
      NOT_SET_UP,
    );
  });

  it("shows a general message for anything else", () => {
    expect(passkeySignInErrorMessage({ code: "CHALLENGE_NOT_FOUND", message: "Challenge not found" })).toBe(
      DID_NOT_FINISH,
    );
    expect(passkeySignInErrorMessage({ code: "ERROR_INVALID_RP_ID", message: "Auth cancelled" })).toBe(DID_NOT_FINISH);
    expect(passkeySignInErrorMessage({ code: "ERROR_AUTHENTICATOR_GENERAL_ERROR", message: "Auth cancelled" })).toBe(
      DID_NOT_FINISH,
    );
    // The rate limiter answers 429 with a message and no code.
    expect(passkeySignInErrorMessage({ message: "Too many requests. Please try again later." })).toBe(DID_NOT_FINISH);
    expect(passkeySignInErrorMessage({})).toBe(DID_NOT_FINISH);
  });
});
