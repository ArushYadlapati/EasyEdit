// Makes public/audio/clean-worklet.js, the preview's audio worklet: src/lib/audio/clean-dsp.ts turned into plain
// JavaScript, with scripts/clean-processor.js after it. A worklet is loaded by the browser as a file of its own,
// outside the app's bundle, so it cannot import the TypeScript; and it is one file with no imports, because not
// every browser lets a worklet import. This keeps one source for the sound clean-up all the same.
// Run it after changing either source: `node scripts/make-worklet.mjs`. A test fails while the file is out of date.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
export const TARGET = join(root, "public", "audio", "clean-worklet.js");
const HEADER = "// Made by scripts/make-worklet.mjs from src/lib/audio/clean-dsp.ts and scripts/clean-processor.js. Change those, not this.\n";

export function made() {
  const dsp = ts.transpileModule(readFileSync(join(root, "src", "lib", "audio", "clean-dsp.ts"), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true, newLine: ts.NewLineKind.LineFeed },
  }).outputText.replace(/^export /gm, "");
  if (/^\s*(import|export)\b/m.test(dsp)) throw new Error("make-worklet: clean-dsp.ts must import nothing and export only declarations.");
  return HEADER + dsp + "\n" + readFileSync(join(here, "clean-processor.js"), "utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, made());
  console.log(`wrote ${TARGET}`);
}
