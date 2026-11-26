import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SITE_METADATA, SITE_VIEWPORT, SitePage } from "@/components/site/site-page";
import { PLAIN_ERROR } from "@/components/ui/cx";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/access";
import { isConnectorRequest, readConsentRequest } from "@/lib/connector/consent";
import { requiredEnv } from "@/lib/env";
import { openSignUp } from "@/lib/signup";
import { loginErrorMessage } from "@/lib/login-error-message";
import { START_PATH } from "@/lib/home/first-project";
import { loginHref, safeNext } from "@/lib/home/safe-next";
import { PasskeySignInButton } from "./passkey-sign-in-button";
import { SignInButton } from "./sign-in-button";
import { SignInPicture } from "./sign-in-picture";

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
  // Where to go once signed in (`next`, only an address on this site): the home page's Create project sends /new, which
  // makes the project the visitor asked for and opens it. Not while connecting an agent, which carries on its own way.
  const next = forClaude ? null : safeNext(params.next);
  // Decided by the allowlist, not by cookie presence, so a removed user's stale cookie cannot loop.
  if (!forClaude && (await getCurrentUser())) redirect(next ?? "/dashboard");
  // The same check as the consent page: a request that has expired or was changed cannot carry on after sign-in.
  const request = forClaude ? await readConsentRequest(getDb(), requiredEnv("BETTER_AUTH_SECRET"), params) : null;
  const expired = request !== null && !request.ok;
  // Only a name EasyEdit worked out itself: an app can register under any name it likes.
  const agentName = request?.ok && request.view.nameVerified ? request.view.agentName : "an AI agent";

  return (
    <SitePage current="login">
      <main className="h-plain h-sign">
        <div className="h-plainColumn h-signColumn">
          <h1 className="h-plainTitle">Sign in</h1>
          {forClaude && !expired && <p className="h-plainLead h-plainInk">{`Sign in to connect ${agentName}.`}</p>}
          {next === START_PATH && <p className="h-plainLead h-plainInk">Sign in, and your project opens in the editor.</p>}
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
          {/* The second sentence on a line of its own, so neither is ever broken mid-way. */}
          <p className="h-plainLead">
            {open ? (
              <>
                Sign in or create an account with Google. <span className="block">EasyEdit is free.</span>
              </>
            ) : (
              CLOSED_BETA
            )}
          </p>
          {/* The site's own pills: white for Google, the quieter tint for a passkey. */}
          <div className="flex flex-col gap-3">
            <SignInButton
              className="h-btn w-full"
              {...(next ? { callbackURL: next, errorCallbackURL: loginHref(next) } : {})}
            />
            <PasskeySignInButton openSignUp={open} next={next ?? undefined} className="h-btn h-btnGhost w-full" />
          </div>
          {/* What signing in hands over, said before the Google screen asks, in the privacy page's own terms. */}
          <p className="h-signNote">
            Google shares your name, email address and profile picture with EasyEdit. Your videos are kept in Google Drive,
            not on EasyEdit&apos;s servers, and EasyEdit only ever sees the files it makes there.{" "}
            <Link href="/privacy">How EasyEdit uses your data</Link>
          </p>
          {/* What signing in agrees to, linked, as the terms say ("By signing in, you agree to them"). */}
          <p className="h-signNote">
            By signing in, you agree to the <Link href="/terms">terms of service</Link>.
          </p>
        </div>
        <SignInPicture />
      </main>
    </SitePage>
  );
}
