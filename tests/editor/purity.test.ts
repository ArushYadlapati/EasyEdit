import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { expect, it } from "vitest";
import { FRAMEWORK_IMPORT, sources } from "../helpers/sources";

it("the framework import pattern catches every way of importing", () => {
  for (const line of [
    'import { useState } from "react";',
    'import "react";',
    'const r = await import("react");',
    'import { createPortal } from "react-dom";',
    'import Link from "next/link";',
    'import { NextResponse } from "next/server";',
    'import next from "next";',
    "const r = require('react');",
  ]) {
    expect(line).toMatch(FRAMEWORK_IMPORT);
  }
  for (const line of ['import { createStore } from "zustand/vanilla";', 'import { nanoid } from "nanoid";', 'import { x } from "./react-like";']) {
    expect(line).not.toMatch(FRAMEWORK_IMPORT);
  }
});

it("editor logic imports no React or Next code", () => {
  for (const [file, code] of sources("src/lib/editor")) {
    expect(code, file).not.toMatch(FRAMEWORK_IMPORT);
  }
});

it("dashboard logic imports no React or Next code", () => {
  const files = sources("src/lib/dashboard");
  expect(files.length).toBeGreaterThan(0);
  for (const [file, code] of files) {
    expect(code, file).not.toMatch(FRAMEWORK_IMPORT);
  }
});

const ZUSTAND_IMPORT = /\b(?:from|import|require)\s*\(?\s*["']zustand(?:\/[^"']*)?["']/;
// One pass: string literals are matched first and kept, so a // or /* inside a string is never read as a comment.
const stripComments = (code: string) =>
  code.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\/.*$|\/\*[\s\S]*?\*\//gm, "$1");
const BROWSER_GLOBAL = /\b(?:window|document|localStorage|navigator)\b/;

it("the compositor is worker-safe: no React, Next or store imports, no browser globals", () => {
  expect(ZUSTAND_IMPORT.test('import { create } from "zustand";')).toBe(true);
  expect(ZUSTAND_IMPORT.test("import 'zustand/vanilla';")).toBe(true);
  expect(BROWSER_GLOBAL.test(stripComments("const w = typeof window;"))).toBe(true);
  expect(BROWSER_GLOBAL.test(stripComments("// window\n/* document */ const a = 1;"))).toBe(false);
  expect(BROWSER_GLOBAL.test(stripComments('const u = "http://x.com"; const d = document;'))).toBe(true);
  expect(BROWSER_GLOBAL.test(stripComments("const a = 1; // window here\n/* and document\n here */ const b = 2;"))).toBe(false);
  expect(stripComments("const s = 'a /* b */ c';")).toBe("const s = 'a /* b */ c';");
  expect(readdirSync("src/lib/render").filter((f) => f.endsWith(".tsx"))).toEqual([]);
  for (const [file, code] of sources("src/lib/render")) {
    expect(code, file).not.toMatch(FRAMEWORK_IMPORT);
    expect(code, file).not.toMatch(ZUSTAND_IMPORT);
    expect(stripComments(code), file).not.toMatch(BROWSER_GLOBAL);
  }
});

// A value import from the timeline's index would pull zod and the op engine into the compositor, so values come from presets.
const TIMELINE_INDEX_VALUE_IMPORT = /^\s*import\s+(?!type\b)[^;]*?from\s*["']@\/lib\/timeline["']/m;

it("the compositor takes timeline values from presets, never from the index", () => {
  expect(TIMELINE_INDEX_VALUE_IMPORT.test('import { stretchOf } from "@/lib/timeline";')).toBe(true);
  expect(TIMELINE_INDEX_VALUE_IMPORT.test('import {\n  stretchOf,\n} from "@/lib/timeline";')).toBe(true);
  expect(TIMELINE_INDEX_VALUE_IMPORT.test('import type { Clip } from "@/lib/timeline";')).toBe(false);
  expect(TIMELINE_INDEX_VALUE_IMPORT.test('import { stretchOf } from "@/lib/timeline/presets";')).toBe(false);
  for (const [file, code] of sources("src/lib/render")) {
    expect(code, file).not.toMatch(TIMELINE_INDEX_VALUE_IMPORT);
  }
});

// A value import or re-export, with the module it names. Type-only imports are skipped: they are erased.
const VALUE_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']/gm;
// An import() of a module named by a string literal: it loads at run time, in the worker too.
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const valueImports = (code: string) => [
  ...[...code.matchAll(VALUE_IMPORT)].map((m) => m[1]),
  ...[...code.matchAll(DYNAMIC_IMPORT)].map((m) => m[1]),
];

// The file under src/ that an import names, or null for a package.
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? `src/${spec.slice(2)}` : spec.startsWith(".") ? normalize(join(dirname(from), spec)) : null;
  if (!base) return null;
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((path) => existsSync(path)) ?? null;
}

// Every file the given files reach through value imports inside src/, themselves included.
function reach(files: string[]): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of valueImports(readFileSync(file, "utf8"))) {
      const next = resolveImport(file, spec);
      if (next) visit(next);
    }
  };
  files.forEach(visit);
  return [...seen].sort();
}

const WORKER_SAFE = ["src/lib/render", "src/lib/export"];

it("the import walker follows value imports and skips type-only ones", () => {
  const code = [
    'import { a } from "./a";', 'import type { B } from "./b";', 'export * from "./c";', 'import "./d";',
    "import {\n  e,\n  f,\n} from \"@/lib/e\";", 'export type { G } from "./g";', 'export const label = "from";',
    'const later = await import("./h");',
  ].join("\n");
  expect(valueImports(code)).toEqual(["./a", "./c", "./d", "@/lib/e", "./h"]);
  expect(resolveImport("src/lib/render/compositor.ts", "./text-layout")).toBe("src/lib/render/text-layout.ts");
  expect(resolveImport("src/lib/render/text-layout.ts", "@/lib/text")).toBe("src/lib/text.ts");
  expect(resolveImport("src/lib/render/compositor.ts", "@/lib/timeline")).toBe("src/lib/timeline/index.ts");
  expect(resolveImport("src/lib/render/compositor.ts", "zod")).toBeNull();
});

it("worker-safe code is clean all the way down: every file it imports is checked too", () => {
  for (const dir of WORKER_SAFE) expect(sources(dir).length, dir).toBeGreaterThan(0);
  const reached = reach(WORKER_SAFE.flatMap((dir) => sources(dir).map(([file]) => file)));
  expect(reached).toContain("src/lib/text.ts"); // the walk leaves the two folders
  for (const file of reached) {
    const code = readFileSync(file, "utf8");
    expect(code, file).not.toMatch(FRAMEWORK_IMPORT);
    expect(code, file).not.toMatch(ZUSTAND_IMPORT);
    expect(stripComments(code), file).not.toMatch(BROWSER_GLOBAL);
  }
  expect(reached.filter((file) => file.startsWith("src/lib/editor/"))).toEqual([]);
});

it("worker-safe code takes timeline values from presets.ts, never from the index", () => {
  for (const dir of WORKER_SAFE) {
    for (const [file, code] of sources(dir)) expect(valueImports(code), file).not.toContain("@/lib/timeline");
  }
});

it("the export worker imports no React, Next or store code, uses no page-only globals, and reaches only worker-safe files", () => {
  // The ingest worker lives beside it and has its own rules (it reads navigator.storage).
  expect(sources("src/workers").map(([file]) => file)).toEqual(expect.arrayContaining(["src/workers/export.worker.ts", "src/workers/ingest.worker.ts"]));
  const code = readFileSync("src/workers/export.worker.ts", "utf8");
  expect(code).not.toMatch(FRAMEWORK_IMPORT);
  expect(code).not.toMatch(ZUSTAND_IMPORT);
  expect(valueImports(code)).not.toContain("@/lib/timeline");
  expect(stripComments(code)).not.toMatch(BROWSER_GLOBAL);
  const safe = new Set(reach(WORKER_SAFE.flatMap((dir) => sources(dir).map(([file]) => file))));
  const reached = reach(["src/workers/export.worker.ts"]).filter((file) => file !== "src/workers/export.worker.ts");
  expect(reached).toEqual(expect.arrayContaining([
    "src/lib/export/pipeline.ts", "src/lib/export/decode-pool.ts", "src/lib/export/worker-session.ts", "src/lib/render/decode-image.ts",
    "src/lib/export/sound-pool.ts", "src/lib/export/aac.ts",
  ]));
  expect(reached.filter((file) => !safe.has(file))).toEqual([]);
});

it("the page loads mediabunny only inside the function that needs it, so the editor's first bundle has none", () => {
  const STATIC_MEDIABUNNY = /\b(?:from|import)\s*["']mediabunny["']/;
  expect('import { Input } from "mediabunny";').toMatch(STATIC_MEDIABUNNY);
  expect('import type { Quality } from "mediabunny";').toMatch(STATIC_MEDIABUNNY);
  expect('const { Input } = await import("mediabunny");').not.toMatch(STATIC_MEDIABUNNY);
  const files = [...sources("src/lib"), ...sources("src/components")];
  expect(files.map(([file]) => file)).toContain("src/lib/export/aac.ts");
  for (const [file, code] of files) expect(code, file).not.toMatch(STATIC_MEDIABUNNY);
});
