// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RootLayout, { viewport } from "@/app/layout";
import { DARK_READER_LOCK_WHEN_DARK } from "@/lib/color-scheme";

// The app's fonts are next/font loaders, which only run in a Next build.
vi.mock("@/app/fonts", () => ({ FONT_VARIABLE_CLASSES: "font-sans font-mono" }));

const LOCK = 'meta[name="darkreader-lock"]';

// A stand-in for the computer's light or dark setting, which the test can change while the page is open.
function stubSystemScheme(dark: boolean) {
  const listeners: Array<() => void> = [];
  const query = {
    matches: dark,
    addEventListener: (_: "change", listener: () => void) => listeners.push(listener),
  };
  vi.stubGlobal("matchMedia", (text: string) => {
    expect(text).toBe("(prefers-color-scheme: dark)");
    return query;
  });
  return {
    switchTo(next: boolean) {
      query.matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function runLockScript() {
  new Function(DARK_READER_LOCK_WHEN_DARK)();
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
});

describe("telling dark-mode tools the page is already dark", () => {
  it("pages follow the computer's light or dark setting unless a route says otherwise", () => {
    expect(viewport).toEqual({ colorScheme: "light dark" });
  });

  it("the root layout runs the Dark Reader script in <head>, before the page paints", () => {
    const html = renderToStaticMarkup(RootLayout({ children: <p>x</p> } as never));
    const page = new DOMParser().parseFromString(html, "text/html");
    expect(page.head.querySelector("script")?.textContent).toBe(DARK_READER_LOCK_WHEN_DARK);
  });

  it("on a computer set to dark, the script asks Dark Reader to leave the page alone", () => {
    stubSystemScheme(true);
    runLockScript();
    expect(document.head.querySelectorAll(LOCK)).toHaveLength(1);
  });

  it("on a computer set to light, the page is light, so Dark Reader may darken it", () => {
    stubSystemScheme(false);
    runLockScript();
    expect(document.head.querySelector(LOCK)).toBeNull();
  });

  it("switching the computer to dark while the page is open adds the lock then", () => {
    const system = stubSystemScheme(false);
    runLockScript();
    system.switchTo(true);
    expect(document.head.querySelectorAll(LOCK)).toHaveLength(1);
    // A second change does not add a second tag.
    system.switchTo(true);
    expect(document.head.querySelectorAll(LOCK)).toHaveLength(1);
  });

  it("a page that already sends the lock does not get a second one", () => {
    document.head.innerHTML = '<meta name="darkreader-lock" content="true">';
    stubSystemScheme(true);
    runLockScript();
    expect(document.head.querySelectorAll(LOCK)).toHaveLength(1);
  });
});
