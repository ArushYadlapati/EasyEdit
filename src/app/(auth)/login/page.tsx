import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/access";
import { isConnectorRequest, readConsentRequest } from "@/lib/connector/consent";
import { requiredEnv } from "@/lib/env";
import { openSignUp } from "@/lib/signup";
import { loginErrorMessage } from "@/lib/login-error-message";
import { PasskeySignInButton } from "./passkey-sign-in-button";
import { SignInButton } from "./sign-in-button";
import { LogoMark } from "@/components/ui/logo";

const ERROR = "rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800";

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
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <LogoMark size={56} />
        <h1 className="text-2xl font-semibold tracking-tight">EasyEdit</h1>
        {forClaude && !expired && <p>{`Sign in to connect ${agentName}.`}</p>}
        {expired && (
          <p role="alert" className={ERROR}>
            This connection request has expired. Go back to your AI agent and connect again.
          </p>
        )}
        {errorMessage !== null && (
          <p role="alert" className={ERROR}>
            {errorMessage}
          </p>
        )}
        {open && <p className="text-sm text-foreground/70">Sign in or create an account with Google.</p>}
        <SignInButton />
        <PasskeySignInButton openSignUp={open} />
      </div>
    </main>
  );
}
