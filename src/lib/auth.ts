import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { mcp } from "@better-auth/mcp";
import { getAuthenticatorName, passkey } from "@better-auth/passkey";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { organization } from "better-auth/plugins/organization";
import { adminAc, defaultStatements } from "better-auth/plugins/organization/access";
import { getDb } from "@/db";
import { makeSessionCreateBefore, makeUserCreateAfter, makeUserCreateBefore } from "@/lib/auth-hooks";
import { isAllowedClientDocument, isAllowedRedirect } from "@/lib/connector/agents";
import { connectorBeforeHook } from "@/lib/connector/auth-rules";
import { DYNAMIC_REGISTRATION, mcpResourceUrl } from "@/lib/connector/config";
import { requiredEnv } from "@/lib/env";

const DAY_SECONDS = 24 * 60 * 60;
// A session lasts this long after its last renewal, so people who keep coming back stay signed in.
const SESSION_SECONDS = 30 * DAY_SECONDS;
// A session is renewed at most once a day.
const SESSION_RENEW_AFTER_SECONDS = DAY_SECONDS;

// A space's roles, stored in member.role. These replace the plugin's owner/admin/member. Editors and viewers get no
// plugin permissions: what they may do with projects and media is the app's own check.
const ac = createAccessControl(defaultStatements);
const admin = ac.newRole(adminAc.statements);
const editor = ac.newRole({});
const viewer = ac.newRole({});

// Every organization endpoint answers 404: spaces are made and joined by the app itself. The app's own hooks.before is
// the connector's, so this is a plugin's path-matched hook, which Better Auth runs alongside it.
const organizationClosed = {
  id: "organization-closed",
  hooks: {
    before: [
      {
        // Stage 3 opens the ones it needs.
        matcher: (ctx) => ctx.path?.startsWith("/organization/") === true,
        handler: createAuthMiddleware(async () => {
          throw new APIError("NOT_FOUND");
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin;

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
      user: { create: { before: makeUserCreateBefore(db), after: makeUserCreateAfter(db) } },
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
        // Desktop agents register loopback or app-scheme addresses without saying they are native apps.
        clientRegistrationDefaultApplicationType: "infer",
        grantTypes: ["authorization_code", "refresh_token"],
        // A member is only ever sent back to a known agent or their own computer, whatever an app's row lists.
        validateRedirectUri: (uri, _registered, matches) => matches && isAllowedRedirect(uri),
        // Nobody manages apps through the API.
        clientPrivileges: () => false,
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
        isMetadataDocumentUrlAllowed: (url) => isAllowedClientDocument(url),
      }),
      organizationClosed,
      // Spaces: a personal space per person and teams. Organizations are made by the app, never through the API.
      organization({
        creatorRole: "admin",
        ac,
        roles: { admin, editor, viewer },
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        schema: {
          organization: {
            additionalFields: {
              kind: { type: ["personal", "team"], required: true, defaultValue: "team", input: false },
            },
          },
        },
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
