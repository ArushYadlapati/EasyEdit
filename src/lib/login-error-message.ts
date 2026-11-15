// With sign-up open, the hook that refuses a user (NOT_ALLOWLISTED) does so only for a Google email Google hasn't
// verified: then the allowlist is never the reason.
export const UNVERIFIED_EMAIL = "Google hasn't verified that email address, so EasyEdit can't use it to sign in.";

// Better Auth sends the user back to /login with ?error=<code>. A database hook that refuses the user
// sends the hook's own code; anything else (a cancelled consent screen, a Google error) sends another code.
// openSignUp: whether anyone may make an account (openSignUp() in signup.ts, read on the server).
export function loginErrorMessage(error: string | undefined, openSignUp = false): string | null {
  if (!error) return null;
  if (error.toUpperCase() === "NOT_ALLOWLISTED") {
    return openSignUp ? UNVERIFIED_EMAIL : "This Google account isn't on the Seattle Solvers allowlist. Ask an admin to add you.";
  }
  if (openSignUp) return "Sign-in didn't finish. Try again.";
  return "Sign-in didn't finish. Try again. If it keeps happening, ask an admin to check that you're on the allowlist.";
}
