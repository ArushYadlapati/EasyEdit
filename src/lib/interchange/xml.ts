// A small XML reader, enough for the timeline files other editors write: elements, attributes, text and CDATA. It
// uses nothing a browser has that a worker or a test lacks. Comments, processing instructions and DOCTYPE lines are
// skipped; namespaces are left in the names as written.

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));
}

// The document's root element, or null when the text is not XML this can read.
export function parseXml(source: string): XmlNode | null {
  const text = source.replace(/^﻿/, "");
  const root: XmlNode = { name: "", attrs: {}, children: [], text: "" };
  const open: XmlNode[] = [root];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    const top = open[open.length - 1];
    if (lt === -1) {
      top.text += unescapeXml(text.slice(i));
      break;
    }
    if (lt > i) top.text += unescapeXml(text.slice(i, lt));
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end === -1) return null;
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end === -1) return null;
      top.text += text.slice(lt + 9, end);
      i = end + 3;
    } else if (text[lt + 1] === "?" || text[lt + 1] === "!") {
      const end = text.indexOf(">", lt);
      if (end === -1) return null;
      i = end + 1;
    } else if (text[lt + 1] === "/") {
      const end = text.indexOf(">", lt);
      if (end === -1 || open.length < 2) return null;
      if (text.slice(lt + 2, end).trim() !== top.name) return null;
      open.pop();
      i = end + 1;
    } else {
      // An opening tag: its end is the first > outside a quoted attribute value.
      let end = lt + 1;
      let quote = "";
      while (end < text.length && (quote !== "" || text[end] !== ">")) {
        if (quote !== "") {
          if (text[end] === quote) quote = "";
        } else if (text[end] === '"' || text[end] === "'") quote = text[end];
        end++;
      }
      if (end >= text.length) return null;
      const selfClosing = text[end - 1] === "/";
      const inside = text.slice(lt + 1, selfClosing ? end - 1 : end);
      const name = /^[^\s]+/.exec(inside)?.[0];
      if (!name) return null;
      const node: XmlNode = { name, attrs: {}, children: [], text: "" };
      for (const m of inside.slice(name.length).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[m[1]] = unescapeXml(m[2] ?? m[3] ?? "");
      top.children.push(node);
      if (!selfClosing) open.push(node);
      i = end + 1;
    }
  }
  return open.length === 1 && root.children.length === 1 ? root.children[0] : null;
}

export const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => node?.children.find((c) => c.name === name);
export const children = (node: XmlNode | undefined, name: string): XmlNode[] => node?.children.filter((c) => c.name === name) ?? [];
// A child's text, trimmed; "" when there is no such child.
export const textOf = (node: XmlNode | undefined, name: string): string => child(node, name)?.text.trim() ?? "";
// A child's text as a number, or null.
export function numberOf(node: XmlNode | undefined, name: string): number | null {
  const raw = textOf(node, name);
  const n = raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}
