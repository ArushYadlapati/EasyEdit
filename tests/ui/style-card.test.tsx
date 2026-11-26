// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { BrandProvider } from "@/components/editor/brand/brand-context";
import { StyleCardProvider } from "@/components/editor/brand/style-card";
import { EditorProvider } from "@/components/editor/context";
import { LeftPanel } from "@/components/editor/left-panel";
import { MediaProvider } from "@/components/editor/media/media-context";
import { DEFAULT_BRAND_KIT } from "@/lib/brand/types";
import { STYLE_WORDS } from "@/lib/style/messages";
import { DEFAULT_STYLE, type Style } from "@/lib/style/types";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, screen, within } from "../helpers/dom";
import { pretendMediaServices } from "../helpers/media-services";

const WORDS = STYLE_WORDS.card;
const style = (over: Partial<Style> = {}): Style => ({ ...DEFAULT_STYLE, updatedAt: "2026-11-25T20:00:00.000Z", updatedBy: "u1", ...over });

type Setup = { load?: (spaceId: string) => Promise<Style>; slug?: string | null; canEdit?: boolean };

// The left panel as the editor draws it, with the Brand kit tab open. load is the call that reads the style.
async function setup({ load = vi.fn(async () => style()), slug = "seattle-solvers", canEdit = true }: Setup = {}) {
  const store = makeStore({ canEdit });
  const services = pretendMediaServices([]);
  const brandApi = { fetch: vi.fn(), save: vi.fn() };
  const tree = () => (
    <EditorProvider store={store}>
      <MediaProvider services={services}>
        <BrandProvider spaceId="s1" canEdit={canEdit} initial={DEFAULT_BRAND_KIT} api={brandApi}>
          <StyleCardProvider spaceId="s1" slug={slug} load={load}>
            <LeftPanel />
          </StyleCardProvider>
        </BrandProvider>
      </MediaProvider>
    </EditorProvider>
  );
  const view = render(tree());
  await act(async () => fireEvent.click(screen.getByRole("tab", { name: "Brand kit" })));
  // Draws everything again from the top, as the editor does when the providers above the tab change.
  const redraw = async () => act(async () => view.rerender(tree()));
  return { store, load, view, redraw };
}

const openTab = async (name: string) => act(async () => fireEvent.click(screen.getByRole("tab", { name })));

const card = () => screen.queryByRole("region", { name: WORDS.heading });
const cardText = () => [...card()!.querySelectorAll("p")].map((p) => p.textContent);

describe("the Style card in the Brand kit tab", () => {
  it("shows the style's summary, with a link to the space's Style page", async () => {
    const { load } = await setup({
      load: vi.fn(async () => style({ profile: { summary: "Fast, funny match recaps.", pace: "quick" }, notes: "Keep it short." })),
    });
    expect(load).toHaveBeenCalledWith("s1");
    expect(cardText()).toEqual(["Fast, funny match recaps."]);
    const link = within(card()!).getByRole("link", { name: WORDS.edit });
    expect(link.getAttribute("href")).toBe("/s/seattle-solvers/settings/style");
  });

  it("sits below the brand kit", async () => {
    await setup();
    const logos = screen.getByRole("region", { name: "Logos" });
    expect(logos.compareDocumentPosition(card()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("without a summary, says the first two things that are set, in plain words", async () => {
    await setup({
      load: vi.fn(async () =>
        style({ profile: { formats: ["short_9x16", "long_16x9"], pace: "quick", shotSeconds: 1.6, music: "upbeat", look: "warm" } }),
      ),
    });
    expect(cardText()).toEqual(["Where you post: Shorts, Reels and TikTok, YouTube", "Pace: Quick"]);
    // Nothing written for agents: no format ids, no frame counts.
    expect(card()!.textContent).not.toMatch(/short_9x16|fps|frames/);
  });

  it("names a choice by itself, and the notes when little else is set", async () => {
    await setup({ load: vi.fn(async () => style({ profile: { music: "soft" }, notes: "  Our logo goes in the last shot.  " })) });
    expect(cardText()).toEqual(["Music: Soft", "Notes for AI agents: Our logo goes in the last shot."]);
  });

  it("says there's no style yet, and still links to the Style page", async () => {
    await setup();
    expect(cardText()).toEqual(["No style yet. Show AI agents how your videos look and feel."]);
    expect(within(card()!).getByRole("link", { name: "Edit style" }).getAttribute("href")).toBe("/s/seattle-solvers/settings/style");
  });

  it("a viewer is offered a look at the style, not a change", async () => {
    await setup({ canEdit: false });
    expect(cardText()).toEqual(["No style yet."]);
    expect(within(card()!).queryByRole("link", { name: WORDS.edit })).toBeNull();
    expect(within(card()!).getByRole("link", { name: "See style" }).getAttribute("href")).toBe("/s/seattle-solvers/settings/style");
  });

  it("isn't there when the style couldn't be read, and the brand kit works as before", async () => {
    await setup({ load: vi.fn(async () => Promise.reject(new Error("Your style couldn't be loaded. Try again."))) });
    expect(card()).toBeNull();
    expect(screen.queryByRole("link", { name: WORDS.edit })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Add title" })).toBeTruthy();
  });

  it("isn't there while the style is on its way", async () => {
    let answer: (s: Style) => void = () => {};
    await setup({ load: vi.fn(() => new Promise<Style>((resolve) => (answer = resolve))) });
    expect(card()).toBeNull();
    await act(async () => answer(style({ profile: { summary: "Calm and warm." } })));
    expect(cardText()).toEqual(["Calm and warm."]);
  });

  it("isn't there, and reads nothing, without the space's slug", async () => {
    const { load } = await setup({ slug: null });
    expect(card()).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("reads the style once while the tab stays open, however often it's drawn, and again when it's opened again", async () => {
    const { load, store, redraw } = await setup();
    await act(async () => store.getState().select(["c1"]));
    await act(async () => store.getState().seek(4));
    await redraw();
    await redraw();
    await act(async () => store.setState({ canEdit: false })); // the card itself draws again
    expect(load).toHaveBeenCalledTimes(1);
    await openTab("Text");
    expect(card()).toBeNull();
    await openTab("Brand kit");
    expect(load).toHaveBeenCalledTimes(2);
    expect(card()).not.toBeNull();
  });

  it("opened again, shows the style it read last at once, then what's read now", async () => {
    let answer: (s: Style) => void = () => {};
    const load = vi
      .fn<(spaceId: string) => Promise<Style>>()
      .mockResolvedValueOnce(style({ profile: { summary: "Calm and warm." } }))
      .mockImplementationOnce(() => new Promise<Style>((resolve) => (answer = resolve)));
    await setup({ load });
    expect(cardText()).toEqual(["Calm and warm."]);
    await openTab("Text");
    await openTab("Brand kit");
    expect(cardText()).toEqual(["Calm and warm."]); // not gone while it's read again
    await act(async () => answer(style({ profile: { summary: "Fast and loud." } })));
    expect(cardText()).toEqual(["Fast and loud."]);
  });

  it("keeps the style it read last when reading it again fails", async () => {
    const load = vi
      .fn<(spaceId: string) => Promise<Style>>()
      .mockResolvedValueOnce(style({ profile: { summary: "Calm and warm." } }))
      .mockRejectedValueOnce(new Error("Your style couldn't be loaded. Try again."));
    await setup({ load });
    await openTab("Text");
    await openTab("Brand kit");
    expect(load).toHaveBeenCalledTimes(2);
    expect(cardText()).toEqual(["Calm and warm."]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
