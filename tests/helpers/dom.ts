import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

export * from "@testing-library/react";

// What a button tells of itself beyond its picture: its tooltip. An icon button's is its name with its key after it,
// read from the description it gives a screen reader, or from its title while it is disabled.
export function tipOf(el: Element): string | null {
  const by = el.getAttribute("aria-describedby");
  return el.getAttribute("title") || (by && document.getElementById(by)?.textContent) || el.getAttribute("aria-label");
}
