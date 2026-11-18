// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import { render } from "../helpers/dom";

const classes = (el: Element) => el.className.split(" ");

describe.each([
  { name: "terms", Page: TermsPage, title: "Terms of service" },
  { name: "privacy", Page: PrivacyPage, title: "Privacy" },
])("the $name page", ({ Page, title }) => {
  it("keeps its title and the link back to EasyEdit", () => {
    const { container } = render(<Page />);
    expect(container.querySelector("h1")?.textContent).toBe(title);
    const back = container.querySelector("article > a");
    expect(back?.getAttribute("href")).toBe("/");
    expect(back?.textContent?.trim()).toBe("EasyEdit");
  });

  it("sets its text in a column about 65 characters wide", () => {
    const { container } = render(<Page />);
    const article = container.querySelector("article")!;
    // 32rem of 16 px Geist. Not 65ch, which comes out near 90 characters because Geist's zero is wide.
    expect(classes(article)).toContain("max-w-lg");
    expect(classes(article).some((c) => c.startsWith("max-w-") && c !== "max-w-lg")).toBe(false);
  });

  it("puts more space above each section heading than below it", () => {
    const { container } = render(<Page />);
    const article = container.querySelector("article")!;
    const headings = Array.from(article.querySelectorAll("h2"));
    expect(headings.length).toBeGreaterThan(5);
    // Paragraphs are 20 px apart. A heading adds 20 px above it (40 in all) and takes 8 px off below it (12).
    expect(classes(article)).toContain("gap-5");
    for (const heading of headings) expect(classes(heading)).toEqual(expect.arrayContaining(["mt-5", "-mb-2"]));
  });
});

it("both pages link back with the mark and the name, only as wide as the words", () => {
  const backs = [render(<TermsPage />).container, render(<PrivacyPage />).container].map((c) => c.querySelector("article > a")!);
  expect(backs[0].className).toBe(backs[1].className);
  for (const back of backs) {
    expect(back.className.split(" ")).toContain("w-fit");
    expect(back.querySelector("svg[aria-hidden]")).toBeTruthy();
  }
});

it("the terms and privacy pages share one reading layout", () => {
  const terms = render(<TermsPage />).container;
  const privacy = render(<PrivacyPage />).container;
  expect(terms.querySelector("article")!.className).toBe(privacy.querySelector("article")!.className);
  const headingClasses = new Set([...terms.querySelectorAll("h2"), ...privacy.querySelectorAll("h2")].map((h) => h.className));
  expect(headingClasses.size).toBe(1);
});
