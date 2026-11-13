// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { readCookie, readKeymap, writeKeymap, writePrefsCookie } from "@/components/editor/browser-prefs";
import { DEFAULT_KEYMAP, KEYMAP_KEY, formatKeymap, setKeys, setOff } from "@/lib/editor/keymap";
import { happyDOM } from "../helpers/layout";

const throwing = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: (): void => {
    throw new Error("blocked");
  },
};

afterEach(() => {
  happyDOM().setURL("http://localhost:3000/editor/p1");
  document.cookie = "easyedit-prefs=; path=/editor; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

it("writePrefsCookie keeps the preferences for editor pages", () => {
  happyDOM().setURL("http://localhost:3000/editor/p1");
  writePrefsCookie("u:cm.sz:1");
  expect(document.cookie).toContain("easyedit-prefs=u:cm.sz:1");
  expect(readCookie("easyedit-prefs")).toBe("u:cm.sz:1");
  expect(readCookie("easyedit-layout")).toBeNull();
  // Other pages, and the API under them, do not get it.
  happyDOM().setURL("http://localhost:3000/dashboard");
  expect(document.cookie).not.toContain("easyedit-prefs");
  expect(readCookie("easyedit-prefs")).toBeNull();
});

it("a browser that refuses cookies changes nothing on the page", () => {
  const refused = vi.spyOn(document, "cookie", "set").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => writePrefsCookie("u:cm")).not.toThrow();
  expect(refused).toHaveBeenCalledTimes(1);
  refused.mockRestore();
  const unreadable = vi.spyOn(document, "cookie", "get").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readCookie("easyedit-prefs")).toBeNull();
  unreadable.mockRestore();
});

it("reads a cookie by its whole name", () => {
  const jar = vi.spyOn(document, "cookie", "get").mockReturnValue("x-easyedit-prefs=u:in; easyedit-prefs=u:cm.sz:0; other=1");
  expect(readCookie("easyedit-prefs")).toBe("u:cm.sz:0");
  expect(readCookie("prefs")).toBeNull();
  jar.mockRestore();
});

it("the keymap is read from and written to storage, and a refusal is quiet", () => {
  const km = setOff(setKeys(DEFAULT_KEYMAP, "split", "Mod+Shift+S"), "delete", true);
  const stored = new Map<string, string>([[KEYMAP_KEY, formatKeymap(km)]]);
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) };
  expect(readKeymap(storage)).toEqual(km);
  expect(readKeymap({ getItem: () => null })).toBe(DEFAULT_KEYMAP);
  expect(readKeymap(throwing)).toBe(DEFAULT_KEYMAP);

  stored.clear();
  writeKeymap(storage, km);
  expect(stored.get(KEYMAP_KEY)).toBe(formatKeymap(km));
  expect(() => writeKeymap(throwing, km)).not.toThrow();
});
