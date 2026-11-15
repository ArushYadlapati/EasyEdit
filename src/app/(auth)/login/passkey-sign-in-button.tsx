"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";
import { passkeySignInErrorMessage } from "@/lib/passkey-error-message";

// The login page's error box.
const ERROR = "rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800";

const noSubscription = () => () => {};

// While Claude is connecting, the sign-in server answers { redirect: true, url } and the auth client follows it to the
// consent page by itself.
function isRedirect(data: unknown): boolean {
  return typeof data === "object" && data !== null && "redirect" in data && data.redirect === true;
}

// openSignUp: whether anyone may make an account, as the login page read it on the server.
export function PasskeySignInButton({ openSignUp = false }: { openSignUp?: boolean } = {}) {
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
  // Pulled up to the Google button so the two read as one pair of choices, as the consent page's buttons do.
  return (
    <div className="-mt-3 flex w-full flex-col gap-3">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="h-11 w-full rounded-full border border-foreground/20 bg-transparent px-5 font-medium text-foreground transition-opacity disabled:opacity-60"
      >
        Sign in with a passkey
      </button>
      {error !== null && (
        <p role="alert" className={ERROR}>
          {error}
        </p>
      )}
    </div>
  );
}
