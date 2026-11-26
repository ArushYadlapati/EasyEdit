// With sign-up open, the hook that refuses a user (NOT_ALLOWLISTED) does so only for a Google email Google hasn't
// verified: then the allowlist is never the reason.
export const UNVERIFIED_EMAIL = "Google hasn't verified that email address, so EasyEdit can't use it to sign in.";

// Google's screen was left (Cancel, or closed) before it finished.
export const GOOGLE_LEFT = "You left Google's screen before it finished. Sign in again when you're ready.";

// Better Auth sends the user back to /login with ?error=<code>. A database hook that refuses the user
// sends the hook's own code; anything else (a cancelled consent screen, a Google error) sends another code.
// openSignUp: whether anyone may make an account (openSignUp() in signup.ts, read on the server).
export function loginErrorMessage(error: string | undefined, openSignUp = false): string | null {
  if (!error) return null;
  if (error.toUpperCase() === "NOT_ALLOWLISTED") {
    return openSignUp ? UNVERIFIED_EMAIL : "This Google account doesn't have access to EasyEdit. If you were invited, sign in with the Google account the invite was sent to.";
  }
  // Google's own code for a screen that was closed or cancelled: nothing went wrong, so it says so.
  if (error.toLowerCase() === "access_denied") return GOOGLE_LEFT;
  if (openSignUp) return "Sign-in didn't finish. Try again.";
  return "Sign-in didn't finish. Try again. If it keeps happening, ask a team admin for a new invite.";
}
