// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import NotFound, { metadata } from "@/app/not-found";
import { render } from "../helpers/dom";

describe("404 page", () => {
  it("says the page wasn't found, with the EasyEdit mark", () => {
    const { container } = render(<NotFound />);
    expect(container.querySelector("h1")?.textContent).toBe("Page not found");
    expect(container.textContent).toContain("404");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("offers a way back home", () => {
    const { container } = render(<NotFound />);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/");
    expect(link?.textContent).toBe("Go to EasyEdit");
  });

  it("names the tab", () => {
    expect(metadata.title).toBe("Page not found · EasyEdit");
  });
});
