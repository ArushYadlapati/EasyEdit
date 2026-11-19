"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { PLAIN_ERROR } from "@/components/ui/cx";
import { authClient } from "@/lib/auth-client";
import { passkeySignInErrorMessage } from "@/lib/passkey-error-message";

const noSubscription = () => () => {};

// While Claude is connecting, the sign-in server answers { redirect: true, url } and the auth client follows it to the
// consent page by itself.
function isRedirect(data: unknown): boolean {
  return typeof data === "object" && data !== null && "redirect" in data && data.redirect === true;
}

// The quieter of the login page's two choices: a pill in a light tint of the text colour, under the white Google one.
const DEFAULT_LOOK =
  "h-11 w-full rounded-full bg-foreground/15 px-5 font-medium text-foreground transition-[background-color,opacity] hover:bg-foreground/20 disabled:opacity-60";

// openSignUp: whether anyone may make an account, as the login page read it on the server. className: the button's
// look, which the sign-in page sets to the public site's quieter pill.
export function PasskeySignInButton({ openSignUp = false, className = DEFAULT_LOOK }: { openSignUp?: boolean; className?: string } = {}) {
  // The server and hydration render without the button; the browser then shows it only if it has WebAuthn.
  const supported = useSyncExternalStore(
    noSubscription,
    () => typeof window.PublicKeyCredential !== "undefined",
    () => false,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One sign-in at a time, even if a second click lands before the button renders as disabled.
  const inFlight = useRef(false);

  async function signIn() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    let message: string | null;
    try {
      const { data, error } = await authClient.signIn.passkey();
      if (!error) {
        // Stays disabled while the browser leaves.
        if (isRedirect(data)) return;
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load, as after Google's sign-in, so the app starts fresh with the new session.
        window.location.assign("/dashboard");
        return;
      }
      message = passkeySignInErrorMessage(error, openSignUp);
    } catch {
      message = passkeySignInErrorMessage({}, openSignUp);
    }
    setError(message);
    setPending(false);
    inFlight.current = false;
  }

  if (!supported) return null;
  return (
    <div className="flex w-full flex-col gap-3">
      <button type="button" onClick={signIn} disabled={pending} className={className}>
        Sign in with a passkey
      </button>
      {error !== null && (
        <p role="alert" className={PLAIN_ERROR}>
          {error}
        </p>
      )}
    </div>
  );
}
