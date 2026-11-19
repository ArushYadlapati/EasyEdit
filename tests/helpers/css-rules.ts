// A stylesheet's rules, flattened: each rule's selectors and declarations, and the @media it sits in (rules inside
// @supports and @container count as their surroundings'). Comments are dropped first.
export type CssRule = { selectors: string[]; decls: Map<string, string>; media: string | null };

export function cssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const walk = (text: string, media: string | null) => {
    let at = 0;
    while (at < text.length) {
      const open = text.indexOf("{", at);
      if (open < 0) return;
      let close = open + 1;
      for (let depth = 1; depth > 0; close++) depth += text[close] === "{" ? 1 : text[close] === "}" ? -1 : 0;
      const head = text.slice(at, open).trim();
      const body = text.slice(open + 1, close - 1);
      at = close;
      if (head.startsWith("@media")) walk(body, head);
      else if (head.startsWith("@supports") || head.startsWith("@container")) walk(body, media);
      else if (!head.startsWith("@")) {
        const decls = new Map<string, string>();
        for (const decl of body.split(";")) {
          const colon = decl.indexOf(":");
          if (colon > 0) decls.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim().replace(/\s+/g, " "));
        }
        rules.push({ selectors: head.split(",").map((s) => s.trim().replace(/\s+/g, " ")), decls, media });
      }
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ""), null);
  return rules;
}
