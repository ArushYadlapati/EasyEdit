// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LogoMark } from "@/components/ui/logo";
import { render } from "../helpers/dom";

describe("LogoMark", () => {
  it("is hidden from screen readers beside the written name", () => {
    const { container } = render(<LogoMark />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
  });

  it("is named when it stands alone", () => {
    const { container } = render(<LogoMark title="EasyEdit" size={32} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("EasyEdit");
    expect(svg.getAttribute("width")).toBe("32");
  });

  it("draws in the text colour with the cut-off pieces in the logo accent, without ids, so it can repeat on a page", () => {
    const { container } = render(
      <>
        <LogoMark />
        <LogoMark />
      </>,
    );
    const fills = [...container.querySelectorAll("svg")[0].querySelectorAll("path")].map((p) => p.getAttribute("fill"));
    expect(fills).toEqual(["currentColor", "var(--logo-accent)"]);
    expect(container.querySelector("[id]")).toBeNull();
  });

  it("has a logo accent in every theme the site uses", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    // light pages, dark pages, the always-dark editor and dashboard, the always-dark public site
    expect(css.match(/--logo-accent:/g)).toHaveLength(4);
    // The public site is dark whatever the computer's setting, so it needs the dark accent even on a light computer.
    const site = css.match(/html:has\(\.h-site\)\s*\{[^}]*\}/)?.[0] ?? "";
    expect(site).toMatch(/--logo-accent:\s*#6ea8ff;/);
  });
});
