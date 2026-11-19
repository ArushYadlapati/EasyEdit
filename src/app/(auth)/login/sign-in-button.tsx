"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

// A pill in the text colour, which follows the computer's light or dark setting (the invite card). The sign-in page
// passes the public site's own pill instead, with its hover and disabled looks.
const DEFAULT_LOOK = "h-11 w-full rounded-full bg-foreground px-5 font-medium text-background transition-opacity disabled:opacity-60";

export function SignInButton({
  callbackURL = "/dashboard",
  errorCallbackURL = "/login",
  className = DEFAULT_LOOK,
}: {
  callbackURL?: string;
  errorCallbackURL?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL,
      errorCallbackURL,
    });
    if (error) setPending(false);
  }

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={pending}
      className={className}
    >
      Sign in with Google
    </button>
  );
}
