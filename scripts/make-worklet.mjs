// Turns src/lib/audio/clean-dsp.ts into plain JavaScript at public/audio/clean-dsp.js, which the preview's audio
// worklet (public/audio/clean-worklet.js) imports. A worklet is loaded by the browser as a file of its own, outside
// the app's bundle, so it cannot import the TypeScript; this keeps one source for the sound clean-up all the same.
// Run it after changing clean-dsp.ts: `node scripts/make-worklet.mjs`. A test fails while the two differ.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = join(root, "src", "lib", "audio", "clean-dsp.ts");
export const TARGET = join(root, "public", "audio", "clean-dsp.js");
const HEADER = "// Made from src/lib/audio/clean-dsp.ts by scripts/make-worklet.mjs. Change that file, not this one.\n";

export function made() {
  const out = ts.transpileModule(readFileSync(SOURCE, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true, newLine: ts.NewLineKind.LineFeed },
  });
  return HEADER + out.outputText;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, made());
  console.log(`wrote ${TARGET}`);
}
