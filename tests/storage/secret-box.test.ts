import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, seal, SecretBoxError } from "@/lib/storage/secret-box";

const key = randomBytes(32);

describe("secret box", () => {
  it("round trips", () => {
    const sealed = seal("1//refresh-token", key);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("refresh-token");
    expect(open(sealed, key)).toBe("1//refresh-token");
  });

  it("seals the same text differently each time", () => {
    expect(seal("a", key)).not.toBe(seal("a", key));
  });

  it("throws when any character is changed", () => {
    const sealed = seal("secret value", key);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let i = 3; i < sealed.length; i++) {
      if (sealed[i] === ".") continue;
      const swap = sealed[i] === alphabet[0] ? alphabet[1] : alphabet[0];
      const bad = sealed.slice(0, i) + swap + sealed.slice(i + 1);
      expect(() => open(bad, key), `index ${i}`).toThrow(SecretBoxError);
    }
  });

  it("throws with the wrong key and on junk", () => {
    const sealed = seal("x", key);
    expect(() => open(sealed, randomBytes(32))).toThrow(SecretBoxError);
    expect(() => open("nonsense", key)).toThrow(SecretBoxError);
    expect(() => open("v2.a.b", key)).toThrow(SecretBoxError);
  });

  it("never puts the text in an error", () => {
    try {
      open(seal("topsecret", key).slice(0, -3) + "AAA", key);
    } catch (e) {
      expect(String(e)).not.toContain("topsecret");
    }
  });
});
