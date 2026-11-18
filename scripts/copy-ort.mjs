// Copies the ONNX runtime's WebAssembly files into public/ort/, so the speech worker loads them from the app and not
// from a public CDN. They come from the onnxruntime-web that @huggingface/transformers itself resolves, so the files
// always match the runtime code bundled into the worker. Runs before `next dev` and `next build`; a file already
// there and identical is left alone.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fromApp = createRequire(join(root, "package.json"));
const fromTransformers = createRequire(fromApp.resolve("@huggingface/transformers"));
const dist = dirname(fromTransformers.resolve("onnxruntime-web")); // every entry point sits in dist/
const target = join(root, "public", "ort");

const files = readdirSync(dist).filter((name) => /^ort-wasm-simd-threaded.*\.(wasm|mjs)$/.test(name));
if (files.length === 0) throw new Error(`No ort-wasm-simd-threaded files in ${dist}.`);

mkdirSync(target, { recursive: true });
let copied = 0;
for (const name of files) {
  const from = join(dist, name);
  const to = join(target, name);
  if (existsSync(to) && readFileSync(to).equals(readFileSync(from))) continue;
  copyFileSync(from, to);
  copied++;
}
console.log(`copy-ort: ${copied} of ${files.length} runtime files copied to public/ort/`);
