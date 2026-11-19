// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import PrivacyPage, { metadata as privacyMetadata, viewport as privacyViewport } from "@/app/privacy/page";
import TermsPage, { metadata as termsMetadata, viewport as termsViewport } from "@/app/terms/page";
import { cssRules } from "../helpers/css-rules";
import { render, screen } from "../helpers/dom";

const classes = (el: Element) => el.className.split(" ");

describe.each([
  { name: "terms", Page: TermsPage, title: "Terms of service", metadata: termsMetadata, viewport: termsViewport },
  { name: "privacy", Page: PrivacyPage, title: "Privacy", metadata: privacyMetadata, viewport: privacyViewport },
])("the $name page", ({ Page, title, metadata, viewport }) => {
  it("keeps its title, at the size of the site's other page titles", () => {
    const { container } = render(<Page />);
    const heading = container.querySelector("article > h1")!;
    expect(heading.textContent).toBe(title);
    expect(classes(heading)).toContain("h-plainTitle");
  });

  it("sits in the public site's frame: the header leads home, and the header and footer are outside main", () => {
    const { container } = render(<Page />);
    expect(container.firstElementChild?.className).toBe("h-site");
    expect(screen.getByRole("link", { name: "EasyEdit home" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("banner").closest("main")).toBeNull();
    expect(screen.getByRole("contentinfo").closest("main")).toBeNull();
    expect(screen.getByRole("main").querySelector("article")).toBeTruthy();
  });

  it("marks itself in the footer as the page being shown, and no other", () => {
    render(<Page />);
    const current = [...screen.getByRole("contentinfo").querySelectorAll("a[aria-current]")];
    expect(current.map((a) => [a.textContent, a.getAttribute("aria-current")])).toEqual([[title === "Privacy" ? "Privacy" : "Terms", "page"]]);
  });

  it("is always dark like the rest of the site", () => {
    expect(metadata.other).toEqual({ "darkreader-lock": "true" });
    expect(viewport.colorScheme).toBe("dark");
  });

  it("names its tab the way the site's other pages do (Sign in · EasyEdit, Page not found · EasyEdit)", () => {
    expect(metadata.title).toBe(`${title === "Privacy" ? "Privacy" : "Terms"} · EasyEdit`);
  });

  it("sets its 16 px text in a column about 65 characters wide, on the site's left edge", () => {
    const { container } = render(<Page />);
    const article = container.querySelector("article")!;
    // 32rem of 16 px Geist. Not 65ch, which comes out near 90 characters because Geist's zero is wide.
    expect(classes(article)).toEqual(expect.arrayContaining(["max-w-lg", "text-base"]));
    expect(classes(article).some((c) => c.startsWith("max-w-") && c !== "max-w-lg")).toBe(false);
    // The same main as sign-in and the not-found page, so the column starts where theirs do.
    expect(article.parentElement!.className).toBe("h-plain");
  });

  it("puts more space above each section heading than below it, and sets it clearly bigger than the text", () => {
    const { container } = render(<Page />);
    const article = container.querySelector("article")!;
    const headings = Array.from(article.querySelectorAll("h2"));
    expect(headings.length).toBeGreaterThan(5);
    // Paragraphs are 20 px apart. A heading adds 28 px above it (48 in all) and takes 8 px off below it (12).
    expect(classes(article)).toContain("gap-5");
    for (const heading of headings) expect(classes(heading)).toEqual(expect.arrayContaining(["mt-7", "-mb-2", "text-2xl"]));
  });
});

it("lets a page's title run past its reading column, so the terms' title isn't broken after its second word", () => {
  const site = cssRules(readFileSync(join(process.cwd(), "src/components/site/site.css"), "utf8"));
  const title = site.find((r) => r.media === null && r.selectors.includes(".h-plainTitle"))!.decls;
  expect(title.get("width")).toBe("max-content");
  // Only the window's own side margins make it wrap (on a phone).
  expect(title.get("max-width")).toBe("calc(100vw - 2 * var(--h-pad))");
  expect(title.get("text-wrap")).toBe("balance");
});

it("sets the terms' date line small, in the site's own muted grey", () => {
  render(<TermsPage />);
  const line = screen.getByText(/^Last updated /);
  expect(classes(line)).toEqual(["text-sm", "text-(--h-muted)"]);
});

it("the terms and privacy pages share one reading layout", () => {
  const terms = render(<TermsPage />).container;
  const privacy = render(<PrivacyPage />).container;
  expect(terms.querySelector("main")!.className).toBe(privacy.querySelector("main")!.className);
  expect(terms.querySelector("article")!.className).toBe(privacy.querySelector("article")!.className);
  expect(terms.querySelector("h1")!.className).toBe(privacy.querySelector("h1")!.className);
  const headingClasses = new Set([...terms.querySelectorAll("h2"), ...privacy.querySelectorAll("h2")].map((h) => h.className));
  expect(headingClasses.size).toBe(1);
});

it("starts every plain page's column on the site's left edge, at the same height under the header", () => {
  const site = cssRules(readFileSync(join(process.cwd(), "src/components/site/site.css"), "utf8"));
  const plain = site.find((r) => r.media === null && r.selectors.includes(".h-plain"))!.decls;
  // Not centred in the window, so going from one page to the next moves nothing sideways.
  for (const centring of ["justify-content", "align-items", "margin", "margin-inline"]) expect(plain.has(centring), centring).toBe(false);
  expect(plain.get("padding")).toBe("clamp(48px, 9vh, 112px) var(--h-pad) clamp(80px, 11vw, 140px)");
  const column = site.find((r) => r.media === null && r.selectors.includes(".h-plainColumn"))!.decls;
  expect(column.has("margin")).toBe(false);
});
