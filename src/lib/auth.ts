import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { mcp } from "@better-auth/mcp";
import { getAuthenticatorName, passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { getDb } from "@/db";
import { makeSessionCreateBefore, makeUserCreateBefore } from "@/lib/auth-hooks";
import { connectorBeforeHook, isClaudeClientDocument, isClaudeRedirect } from "@/lib/connector/auth-rules";
import { DYNAMIC_REGISTRATION, mcpResourceUrl } from "@/lib/connector/config";
import { requiredEnv } from "@/lib/env";

const DAY_SECONDS = 24 * 60 * 60;
// A session lasts this long after its last renewal, so people who keep coming back stay signed in.
const SESSION_SECONDS = 30 * DAY_SECONDS;
// A session is renewed at most once a day.
const SESSION_RENEW_AFTER_SECONDS = DAY_SECONDS;

function createAuth() {
  const db = getDb();
  return betterAuth({
    // neon-http cannot run transactions, so the adapter must never open one.
    database: drizzleAdapter(db, { provider: "pg", transaction: false }),
    secret: requiredEnv("BETTER_AUTH_SECRET"),
    trustedOrigins: [requiredEnv("BETTER_AUTH_URL")],
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: requiredEnv("GOOGLE_CLIENT_ID"),
        clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
        prompt: "select_account",
      },
    },
    // Every request must reach the database so a removed user is locked out on their next request.
    session: {
      cookieCache: { enabled: false },
      expiresIn: SESSION_SECONDS,
      updateAge: SESSION_RENEW_AFTER_SECONDS,
    },
    databaseHooks: {
      user: { create: { before: makeUserCreateBefore(db) } },
      session: { create: { before: makeSessionCreateBefore(db) } },
    },
    plugins: [
      // Signs the connector's access tokens. Session responses carry no token header.
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        resource: mcpResourceUrl(),
        loginPage: "/login",
        consentPage: "/consent",
        allowDynamicClientRegistration: DYNAMIC_REGISTRATION,
        allowUnauthenticatedClientRegistration: DYNAMIC_REGISTRATION,
        grantTypes: ["authorization_code", "refresh_token"],
        // A member is only ever sent back to Claude, whatever an app's document or stored row lists.
        validateRedirectUri: (uri, _registered, matches) => matches && isClaudeRedirect(uri),
        // Nobody manages apps through the API.
        clientPrivileges: () => false,
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
        isMetadataDocumentUrlAllowed: (url) => isClaudeClientDocument(url),
      }),
      passkey({
        rpID: new URL(requiredEnv("BETTER_AUTH_URL")).hostname,
        rpName: "EasyEdit",
        origin: new URL(requiredEnv("BETTER_AUTH_URL")).origin,
        // No authenticatorAttachment, so 1Password, phones and security keys are offered, not only this device.
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
        registration: {
          // Named after the passkey manager when it says which it is. Apple's all-zero AAGUID gets "Passkey".
          afterVerification: ({ verification }) => ({
            name: getAuthenticatorName(verification.registrationInfo?.aaguid) ?? "Passkey",
          }),
        },
      }),
    ],
    // On everywhere, not only in production. Counted in the database: an in-memory count would
    // reset with every new server instance.
    rateLimit: {
      enabled: true,
      storage: "database",
      // A passkey sign-in gets the same limit as Better Auth's own sign-in rule.
      customRules: {
        "/passkey/verify-authentication": { window: 10, max: 3 },
        "/passkey/generate-authenticate-options": { window: 10, max: 10 },
      },
    },
    // The jwt plugin's session-to-token endpoint is off. The only tokens handed out are the connector's.
    disabledPaths: ["/token"],
    hooks: { before: connectorBeforeHook() },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as typeof globalThis & { __easyEditAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__easyEditAuth ??= createAuth();
  return globalForAuth.__easyEditAuth;
}
