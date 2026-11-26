import { afterEach, describe, expect, it, vi } from "vitest";
import { metadata as rootMetadata } from "@/app/layout";
import OpenGraphImage, { alt, contentType, size } from "@/app/opengraph-image";
import { metadata as homeMetadata } from "@/app/page";
import { SITE_DESCRIPTION } from "@/lib/home/site-description";

vi.mock("@/lib/access", () => ({ getCurrentUser: async () => null }));
vi.mock("@/app/fonts", () => ({ FONT_VARIABLE_CLASSES: "" }));

afterEach(() => vi.unstubAllGlobals());

describe("what a shared link to EasyEdit shows", () => {
  it("says what it is, that it's free and where the videos stay, with no hype word", () => {
    expect(SITE_DESCRIPTION).toBe(
      "A video editor in your browser that you and your AI agent edit together. Free, and your videos stay in your own Google Drive.",
    );
    expect(SITE_DESCRIPTION).not.toMatch(/AI-first/);
    expect(rootMetadata.description).toBe(SITE_DESCRIPTION);
    expect(rootMetadata.openGraph?.description).toBe(SITE_DESCRIPTION);
    expect(rootMetadata.twitter).toEqual({ card: "summary_large_image" });
  });

  it("titles the home page with what EasyEdit is", () => {
    expect(homeMetadata.title).toBe("EasyEdit · The video editor for AI agents, teams and creators");
    expect(homeMetadata.openGraph).toMatchObject({ title: homeMetadata.title, description: SITE_DESCRIPTION });
    // Still always dark.
    expect(homeMetadata.other).toEqual({ "darkreader-lock": "true" });
  });

  it("draws a picture at the size link previews use, with words for it, even when its font can't be fetched", async () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt).toBe("EasyEdit: the video editor for AI agents. Free, and your videos stay in your own Google Drive.");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const picture = await OpenGraphImage();
    const bytes = new Uint8Array(await picture.arrayBuffer());
    expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
  }, 30000);
});
