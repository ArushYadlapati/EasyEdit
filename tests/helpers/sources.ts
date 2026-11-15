import { readFileSync, readdirSync } from "node:fs";

// Every .ts and .tsx file under a folder, as [path, text].
export const sources = (dir: string): (readonly [string, string])[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) ? [[path, readFileSync(path, "utf8")] as const] : [];
  });

// A static import, a bare side-effect import, a dynamic import() or a require() of React or Next.
export const FRAMEWORK_IMPORT = /\b(?:from|import|require)\s*\(?\s*["'](?:react|react-dom|next)(?:\/[^"']*)?["']/;

export const importsFrom = (pkg: string) => new RegExp(`\\b(?:from|import|require)\\s*\\(?\\s*["']${pkg}(?:/[^"']*)?["']`);

// A file that starts with the "use client" directive (after comments and blank lines).
export const USE_CLIENT_AT_TOP = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;

// The static imports of a file: what it names, and from where. Type-only imports (whole or per name) carry no value.
export type ImportLine = { from: string; values: string[]; namespace: boolean };
export function importsOf(code: string): ImportLine[] {
  const lines: ImportLine[] = [];
  const pattern = /^\s*import\s+(type\s+)?([^;'"]*?)\s+from\s+["']([^"']+)["']/gm;
  for (const match of code.matchAll(pattern)) {
    const [, typeOnly, clause, from] = match;
    if (typeOnly) continue;
    const values: string[] = [];
    let namespace = false;
    const braces = /\{([\s\S]*)\}/.exec(clause!);
    for (const item of braces ? braces[1]!.split(",") : []) {
      const name = item.trim();
      if (!name || name.startsWith("type ")) continue;
      values.push(name.split(/\s+as\s+/)[0]!.trim());
    }
    const outside = clause!.replace(/\{[\s\S]*\}/, "").split(",").map((part) => part.trim()).filter(Boolean);
    for (const part of outside) {
      if (part.startsWith("*")) namespace = true;
      else values.push(part); // a default import, by its local name
    }
    lines.push({ from: from!, values, namespace });
  }
  return lines;
}

// A component's name: PascalCase, letters and digits only.
export const isComponentName = (name: string) => /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)*$|^[A-Z]$/.test(name);
