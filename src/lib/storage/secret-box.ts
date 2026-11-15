import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

// What every failed open becomes. The message never holds the sealed text or the plain text.
export class SecretBoxError extends Error {
  name = "SecretBoxError" as const;
  constructor() {
    super("Could not open the sealed value");
  }
}

// AES-256-GCM. The key is 32 bytes. Sealed form: "v1.<iv b64url>.<ciphertext + tag b64url>".
export function seal(plain: string, key: Uint8Array): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${iv.toString("base64url")}.${body.toString("base64url")}`;
}

// Throws SecretBoxError on a changed value, a wrong key or anything that is not a sealed value.
export function open(sealed: string, key: Uint8Array): string {
  try {
    const parts = sealed.split(".");
    if (parts.length !== 3 || parts[0] !== VERSION) throw new Error();
    const iv = Buffer.from(parts[1], "base64url");
    const body = Buffer.from(parts[2], "base64url");
    // Base64url decoding drops stray bits, so a changed last character could still decode alike: require an exact round trip.
    if (iv.length !== IV_BYTES || body.length < TAG_BYTES) throw new Error();
    if (iv.toString("base64url") !== parts[1] || body.toString("base64url") !== parts[2]) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError(); // the cipher's own errors are dropped
  }
}
