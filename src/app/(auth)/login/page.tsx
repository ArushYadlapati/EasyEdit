import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { SITE_METADATA, SITE_VIEWPORT, SitePage } from "@/components/site/site-page";
import { PLAIN_ERROR } from "@/components/ui/cx";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/access";
import { isConnectorRequest, readConsentRequest } from "@/lib/connector/consent";
import { requiredEnv } from "@/lib/env";
import { openSignUp } from "@/lib/signup";
import { loginErrorMessage } from "@/lib/login-error-message";
import { PasskeySignInButton } from "./passkey-sign-in-button";
import { SignInButton } from "./sign-in-button";

// In the public site's frame, always dark like the home page; the header leads back home, and leaves out its own Sign in
// and Start free, which lead here.
export const metadata: Metadata = { ...SITE_METADATA, title: "Sign in · EasyEdit" };
export const viewport: Viewport = SITE_VIEWPORT;

// The home page says the same while sign-up is closed.
const CLOSED_BETA = "EasyEdit is in closed beta. Sign-in is by invitation only for now.";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const { error } = params;
  const open = openSignUp();
  const errorMessage = loginErrorMessage(Array.isArray(error) ? error[0] : error, open);
  // Sent here by the sign-in server while connecting an AI agent: signing in carries on with that request.
  const forClaude = isConnectorRequest(params);
  // Decided by the allowlist, not by cookie presence, so a removed user's stale cookie cannot loop.
  if (!forClaude && (await getCurrentUser())) redirect("/dashboard");
  // The same check as the consent page: a request that has expired or was changed cannot carry on after sign-in.
  const request = forClaude ? await readConsentRequest(getDb(), requiredEnv("BETTER_AUTH_SECRET"), params) : null;
  const expired = request !== null && !request.ok;
  // Only a name EasyEdit worked out itself: an app can register under any name it likes.
  const agentName = request?.ok && request.view.nameVerified ? request.view.agentName : "an AI agent";

  return (
    <SitePage current="login">
      <main className="h-plain">
        <div className="h-plainColumn h-plainNarrow">
          <h1 className="h-plainTitle">Sign in</h1>
          {forClaude && !expired && <p className="h-plainLead h-plainInk">{`Sign in to connect ${agentName}.`}</p>}
          {expired && (
            <p role="alert" className={PLAIN_ERROR}>
              This connection request has expired. Go back to your AI agent and connect again.
            </p>
          )}
          {errorMessage !== null && (
            <p role="alert" className={PLAIN_ERROR}>
              {errorMessage}
            </p>
          )}
          <p className="h-plainLead">{open ? "Sign in or create an account with Google." : CLOSED_BETA}</p>
          {/* The site's own pills: white for Google, the quieter tint for a passkey. */}
          <div className="flex flex-col gap-3">
            <SignInButton className="h-btn w-full" />
            <PasskeySignInButton openSignUp={open} className="h-btn h-btnGhost w-full" />
          </div>
        </div>
      </main>
    </SitePage>
  );
}
