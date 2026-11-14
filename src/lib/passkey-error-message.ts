// What `authClient.signIn.passkey()` returns as `error`. A failure in the browser's passkey sheet keeps
// SimpleWebAuthn's code (the message is always "Auth cancelled"); a refusal from the server carries the server's code.
type PasskeySignInError = { code?: string; message?: string };

// Closing the sheet or letting it time out is NotAllowedError, which SimpleWebAuthn passes through under its own
// code. AUTH_CANCELLED is the plugin's code for a browser error that isn't one of SimpleWebAuthn's.
const CANCELLED = new Set(["ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", "ERROR_CEREMONY_ABORTED", "AUTH_CANCELLED"]);

// PASSKEY_NOT_FOUND: no stored passkey has that credential (deleted from EasyEdit, or never added).
// AUTHENTICATION_FAILED: one does, but the response doesn't verify against it.
const NOT_SET_UP = new Set(["PASSKEY_NOT_FOUND", "AUTHENTICATION_FAILED"]);

export function passkeySignInErrorMessage(error: PasskeySignInError | null): string | null {
  if (!error) return null;
  const code = error.code?.toUpperCase();
  if ((code !== undefined && CANCELLED.has(code)) || error.message?.includes("NotAllowedError")) return null;
  // The session hook refuses an account that isn't on the allowlist, whichever way it signs in.
  if (code === "NOT_ALLOWLISTED") {
    return "This account isn't on the Seattle Solvers allowlist. Ask an admin to add you.";
  }
  if (code !== undefined && NOT_SET_UP.has(code)) {
    return "That passkey isn't set up for EasyEdit. Sign in with Google, then add a passkey from your account menu.";
  }
  return "Passkey sign-in didn't finish. Try again, or sign in with Google.";
}
