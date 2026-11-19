// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LogoMark } from "@/components/ui/logo";
import { render } from "../helpers/dom";

const fillsOf = (svg: Element) => [...svg.querySelectorAll("path")].map((p) => p.getAttribute("fill"));

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
  });

  it("takes its size as the height and is wider than it is tall", () => {
    const { container } = render(<LogoMark size={32} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("height")).toBe("32");
    expect(svg.getAttribute("width")).toBe("47");
  });

  it("draws the play button and two frames in the three logo blues, without ids, so it can repeat on a page", () => {
    const { container } = render(
      <>
        <LogoMark size={24} />
        <LogoMark size={24} />
      </>,
    );
    expect(fillsOf(container.querySelectorAll("svg")[0])).toEqual(["var(--logo-1)", "var(--logo-2)", "var(--logo-3)"]);
    expect(container.querySelector("[id]")).toBeNull();
  });

  it("draws one frame instead of two when it is small, so the gaps stay open", () => {
    const { container } = render(<LogoMark size={23} />);
    const svg = container.querySelector("svg")!;
    expect(fillsOf(svg)).toEqual(["var(--logo-1)", "var(--logo-2)"]);
    expect(svg.getAttribute("width")).toBe("30");
  });

  it("has the three logo blues in every theme the site uses", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    // light pages, dark pages, the always-dark editor and dashboard, the always-dark public site
    for (const name of ["--logo-1:", "--logo-2:", "--logo-3:"]) expect(css.split(name)).toHaveLength(5);
    // Light pages take the set one step deeper, so the front shape still shows on white.
    const light = css.match(/:root\s*\{[^}]*\}/)?.[0] ?? "";
    expect(light).toMatch(/--logo-1:\s*#6ea8ff;[^}]*--logo-2:\s*#2f6fdb;[^}]*--logo-3:\s*#163a85;/);
    // The public site is dark whatever the computer's setting, so it needs the dark set even on a light computer.
    const site = css.match(/html:has\(\.h-site\)\s*\{[^}]*\}/)?.[0] ?? "";
    expect(site).toMatch(/--logo-1:\s*#b8d4ff;[^}]*--logo-2:\s*#6ea8ff;[^}]*--logo-3:\s*#2f6fdb;/);
  });

  it("leaves no page still setting the old one-colour logo accent", () => {
    for (const file of ["src/app/globals.css", "src/components/home/home.css", "src/components/site/site.css"]) {
      expect(readFileSync(file, "utf8")).not.toContain("--logo-accent");
    }
  });
});
