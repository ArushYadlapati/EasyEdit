import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { cose, isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

const BASE_URL = "http://localhost:3000";

// Authenticator data flags: user present, user verified, backup eligible, backed up, attested credential data.
const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const AT = 0x40;

// What iCloud Keychain reports: no model at all.
export const ANONYMOUS_AAGUID = "00000000-0000-0000-0000-000000000000";
export const ONE_PASSWORD_AAGUID = "bada5566-a7aa-401f-bd96-45619a55120d";

export type SoftAuthenticator = {
  // The credential's id as the server stores it.
  readonly credentialId: string;
  readonly counter: number;
  register(options: PublicKeyCredentialCreationOptionsJSON, origin: string): Promise<RegistrationResponseJSON>;
  authenticate(options: PublicKeyCredentialRequestOptionsJSON, origin: string): Promise<AuthenticationResponseJSON>;
};

type CBOR = Parameters<typeof isoCBOR.encode>[0];

const sha256 = (data: string | Uint8Array) => new Uint8Array(createHash("sha256").update(data).digest());

const uint32 = (n: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n);
  return bytes;
};

const clientData = (type: "webauthn.create" | "webauthn.get", challenge: string, origin: string) =>
  isoBase64URL.fromUTF8String(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

class DomError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

// One passkey in a passkey manager, as navigator.credentials would hand it over: a P-256 key made here, "none"
// attestation, a counter that goes up with every use, and the account's user handle (a discoverable credential). The
// key exists from the start, so a passkey that was never added to EasyEdit can still try to sign in. `credentialId`
// gives it another passkey's id with its own key, as a forged authenticator could: "none" attestation signs nothing.
export function createSoftAuthenticator(opts: { aaguid?: string; credentialId?: string } = {}): SoftAuthenticator {
  const aaguid = Buffer.from((opts.aaguid ?? ANONYMOUS_AAGUID).replaceAll("-", ""), "hex");
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const rawId = opts.credentialId === undefined ? new Uint8Array(randomBytes(32)) : isoBase64URL.toBuffer(opts.credentialId);
  const credentialId = isoBase64URL.fromBuffer(rawId);
  let counter = 0;
  let rpId: string | undefined;
  let userHandle = isoBase64URL.fromBuffer(new Uint8Array(randomBytes(16)));

  const jwk = publicKey.export({ format: "jwk" });
  const cosePublicKey = isoCBOR.encode(new Map<number, CBOR>([
    [cose.COSEKEYS.kty, cose.COSEKTY.EC2],
    [cose.COSEKEYS.alg, cose.COSEALG.ES256],
    [cose.COSEKEYS.crv, cose.COSECRV.P256],
    [cose.COSEKEYS.x, isoBase64URL.toBuffer(jwk.x!)],
    [cose.COSEKEYS.y, isoBase64URL.toBuffer(jwk.y!)],
  ]));

  return {
    credentialId,
    get counter() {
      return counter;
    },

    async register(options, origin) {
      // The browser refuses to make a second passkey in a manager that already holds one for this account.
      if (options.excludeCredentials?.some((c) => c.id === credentialId)) {
        throw new DomError("InvalidStateError", "The authenticator was previously registered");
      }
      if (!options.pubKeyCredParams.some((p) => p.alg === cose.COSEALG.ES256)) throw new Error("ES256 was not offered");
      rpId = options.rp.id ?? new URL(origin).hostname;
      userHandle = options.user.id;
      const authData = Buffer.concat([
        sha256(rpId),
        Uint8Array.of(UP | UV | BE | BS | AT),
        uint32(counter),
        aaguid,
        Uint8Array.of(rawId.length >> 8, rawId.length & 0xff),
        rawId,
        cosePublicKey,
      ]);
      const attestationObject = isoCBOR.encode(new Map<string, CBOR>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", new Uint8Array(authData)],
      ]));
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: { credProps: { rk: true } },
        response: {
          clientDataJSON: clientData("webauthn.create", options.challenge, origin),
          attestationObject: isoBase64URL.fromBuffer(attestationObject),
          authenticatorData: isoBase64URL.fromBuffer(new Uint8Array(authData)),
          transports: ["hybrid", "internal"],
          publicKeyAlgorithm: cose.COSEALG.ES256,
          publicKey: isoBase64URL.fromBuffer(new Uint8Array(publicKey.export({ format: "der", type: "spki" }))),
        },
      };
    },

    async authenticate(options, origin) {
      const asked = options.rpId ?? new URL(origin).hostname;
      // A passkey made for one site never answers another.
      if (rpId !== undefined && rpId !== asked) throw new DomError("NotAllowedError", `this passkey is for ${rpId}`);
      // A request naming its credentials only gets an answer from one of them.
      if (options.allowCredentials?.length && !options.allowCredentials.some((c) => c.id === credentialId)) {
        throw new DomError("NotAllowedError", "no matching passkey");
      }
      counter += 1;
      const authData = Buffer.concat([sha256(asked), Uint8Array.of(UP | UV | BE | BS), uint32(counter)]);
      const clientDataJSON = clientData("webauthn.get", options.challenge, origin);
      // ES256 signs authenticator data followed by the hash of the client data, DER-encoded as WebAuthn expects.
      const signature = sign("sha256", Buffer.concat([authData, sha256(isoBase64URL.toBuffer(clientDataJSON))]), privateKey);
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON,
          authenticatorData: isoBase64URL.fromBuffer(new Uint8Array(authData)),
          signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
          userHandle,
        },
      };
    },
  };
}

export type Send = (request: Request) => Promise<Response>;

// Like the plugin's client: the extension results stay in the browser.
function asSent<T extends { clientExtensionResults: unknown }>(credential: T): Omit<T, "clientExtensionResults"> {
  const copy: Partial<T> = { ...credential };
  delete copy.clientExtensionResults;
  return copy as Omit<T, "clientExtensionResults">;
}

const cookiesOf = (res: Response) => res.headers.getSetCookie().map((line) => line.split(";")[0]);
const joinCookies = (...cookies: (string | undefined)[]) => cookies.filter((c) => c).join("; ");

// What the browser does when a member presses "Add a passkey": the options request, the passkey manager's sheet, then
// the verify request with the challenge cookie.
export async function addPasskey(send: Send, input: {
  cookie?: string; authenticator: SoftAuthenticator; ip: string;
  // Options from an earlier request, to answer them later (a session that went stale in between, say).
  options?: { body: PublicKeyCredentialCreationOptionsJSON; cookie: string };
}): Promise<Response> {
  const options = input.options ?? await registrationOptions(send, { cookie: input.cookie, ip: input.ip });
  const response = asSent(await input.authenticator.register(options.body, BASE_URL));
  return send(new Request(`${BASE_URL}/api/auth/passkey/verify-registration`, {
    method: "POST",
    headers: {
      "content-type": "application/json", origin: BASE_URL, "x-forwarded-for": input.ip,
      cookie: joinCookies(input.cookie, options.cookie),
    },
    body: JSON.stringify({ response }),
  }));
}

export async function registrationOptions(send: Send, input: { cookie?: string; ip: string }) {
  const res = await send(new Request(`${BASE_URL}/api/auth/passkey/generate-register-options`, {
    headers: { "x-forwarded-for": input.ip, ...(input.cookie ? { cookie: input.cookie } : {}) },
  }));
  if (res.status !== 200) throw new Error(`no registration options: ${res.status} ${await res.text()}`);
  return { body: (await res.json()) as PublicKeyCredentialCreationOptionsJSON, cookie: joinCookies(...cookiesOf(res)) };
}

// What the browser does when the member presses "Sign in with a passkey" on /login?<oauthQuery>: the options request,
// the passkey manager's sheet, then the verify request. The connector's client plugin adds the signed query to the POST.
export async function signInWithPasskey(send: Send, input: {
  authenticator: SoftAuthenticator; ip: string; oauthQuery?: string;
  // Swaps a part of the answer before it is sent, for forgeries.
  tamper?: (response: Omit<AuthenticationResponseJSON, "clientExtensionResults">) => void;
}): Promise<Response> {
  const res = await send(new Request(`${BASE_URL}/api/auth/passkey/generate-authenticate-options`, {
    headers: { "x-forwarded-for": input.ip },
  }));
  if (res.status !== 200) return res;
  const options = (await res.json()) as PublicKeyCredentialRequestOptionsJSON;
  const response = asSent(await input.authenticator.authenticate(options, BASE_URL));
  input.tamper?.(response);
  return send(new Request(`${BASE_URL}/api/auth/passkey/verify-authentication`, {
    method: "POST",
    headers: {
      "content-type": "application/json", origin: BASE_URL, "x-forwarded-for": input.ip,
      "sec-fetch-mode": "cors", cookie: joinCookies(...cookiesOf(res)),
    },
    body: JSON.stringify({ response, ...(input.oauthQuery ? { oauth_query: input.oauthQuery } : {}) }),
  }));
}

// The session cookie a response sets, ready to send back; null when it sets none.
export function sessionCookieOf(res: Response): string | null {
  const pair = cookiesOf(res).find((c) => c.includes("session_token=") && !c.endsWith("="));
  return pair ?? null;
}
