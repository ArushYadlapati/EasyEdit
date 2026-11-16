"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignInButton({ callbackURL = "/dashboard", errorCallbackURL = "/login" }: { callbackURL?: string; errorCallbackURL?: string }) {
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
      className="h-11 w-full rounded-full bg-foreground px-5 font-medium text-background transition-opacity disabled:opacity-60"
    >
      Sign in with Google
    </button>
  );
}
