import { existsSync, readFileSync } from "node:fs";
import { dirname, normalize } from "node:path";
import { expect, it } from "vitest";
import { USE_CLIENT_AT_TOP, importsOf, isComponentName, sources } from "../helpers/sources";

// A server file (no "use client") gets only a reference for each value it imports from a "use client" module. A
// component rendered as JSX works through that reference; calling a function, using a hook or reading a constant
// does not, and a real build fails on it at request time (happy-dom tests never see it). So from such a module a
// server file may import components only.

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

// The file an import names inside src, or null for a package.
function resolve(file: string, from: string): string | null {
  const base = from.startsWith("@/") ? `src/${from.slice(2)}` : from.startsWith(".") ? normalize(`${dirname(file)}/${from}`) : null;
  if (base === null) return null;
  if (/\.tsx?$/.test(base) && existsSync(base)) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  return null;
}

const isClient = (file: string) => USE_CLIENT_AT_TOP.test(readFileSync(file, "utf8"));

// What a server file imports from client modules that isn't a component, as "file: name from module".
function refusals(file: string, code: string): string[] {
  if (USE_CLIENT_AT_TOP.test(code)) return [];
  return importsOf(code).flatMap(({ from, values, namespace }) => {
    const target = resolve(file, from);
    if (!target || !isClient(target)) return [];
    const bad = values.filter((name) => !isComponentName(name));
    if (namespace) bad.push("* (a namespace import)");
    return bad.map((name) => `${file}: ${name} from ${from} ("use client")`);
  });
}

it("server files import only components from client modules", () => {
  const found = sources("src").flatMap(([file, code]) => refusals(file, code));
  expect(found, "a server file calls or reads client code; move it to a plain module, or mark the file \"use client\"").toEqual([]);
});

it("the check reads imports and names as it should", () => {
  expect(importsOf('import { Button, linkButtonClass } from "@/components/ui/button";')).toEqual([
    { from: "@/components/ui/button", values: ["Button", "linkButtonClass"], namespace: false },
  ]);
  expect(importsOf('import type { DashboardProps } from "./dashboard";')).toEqual([]);
  expect(importsOf('import { type MySpace, SpacesProvider as Provider } from "./space-switcher";')).toEqual([
    { from: "./space-switcher", values: ["SpacesProvider"], namespace: false },
  ]);
  expect(importsOf('import Link from "next/link";\nimport * as Ui from "./ui";\nimport Page, { helper } from "./page";')).toEqual([
    { from: "next/link", values: ["Link"], namespace: false },
    { from: "./ui", values: [], namespace: true },
    { from: "./page", values: ["helper", "Page"], namespace: false },
  ]);
  expect(importsOf('import {\n  StorageBanner,\n  storageCard,\n} from "@/components/storage/storage-banner";')[0]!.values).toEqual(["StorageBanner", "storageCard"]);
  for (const name of ["Button", "StorageBanner", "A", "Dialog2"]) expect(isComponentName(name), name).toBe(true);
  for (const name of ["linkButtonClass", "useMedia", "SIDEBAR_HEADING", "FADE", "cx", "Not_A"]) expect(isComponentName(name), name).toBe(false);
  expect(USE_CLIENT_AT_TOP.test('"use client";\nexport const a = 1;')).toBe(true);
  expect(USE_CLIENT_AT_TOP.test("// a note\n'use client'\n")).toBe(true);
  expect(USE_CLIENT_AT_TOP.test('import x from "y";\nconst mode = "use client";')).toBe(false);
  expect(resolve("src/components/storage/storage-banner.tsx", "@/components/ui/button")).toBe("src/components/ui/button.tsx");
  expect(resolve("src/components/dashboard/sidebar.tsx", "./space-switcher")).toBe("src/components/dashboard/space-switcher.tsx");
  expect(resolve("src/x.ts", "next/link")).toBeNull();
});
