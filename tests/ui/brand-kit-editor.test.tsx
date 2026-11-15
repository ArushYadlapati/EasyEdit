// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { BrandKitEditor } from "@/components/brand/brand-kit-editor";
import { MediaProvider } from "@/components/editor/media/media-context";
import { DEFAULT_BRAND_KIT, type BrandKit } from "@/lib/brand/types";
import { cssFontFamily } from "@/lib/editor/fonts";
import { fireEvent, render, screen, within } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

const logo = assetView({ id: "l1", kind: "image", name: "Solvers logo", durationMs: null, previewStatus: "none", previewFileId: null });
const KIT: BrandKit = { ...DEFAULT_BRAND_KIT, fonts: { title: "Orbitron", subtitle: "Geist", body: "Inter" }, colors: ["#ff5a1f", "#111111"], logos: [logo] };

function setup(over: Partial<Parameters<typeof BrandKitEditor>[0]> = {}) {
  const props = { kit: KIT, canEdit: true, save: vi.fn(async () => {}), layout: "panel" as const, ...over };
  render(<MediaProvider services={pretendMediaServices([logo])}><BrandKitEditor {...props} /></MediaProvider>);
  return props;
}

it("shows each role in its font", () => {
  setup({ onUseFont: vi.fn() });
  expect(screen.getByRole("button", { name: "Add title" }).style.fontFamily).toBe(cssFontFamily("Orbitron"));
  expect(screen.getByRole("button", { name: "Add body text" }).style.fontFamily).toBe(cssFontFamily("Inter"));
});

it("clicking a font, a color or a logo uses it", () => {
  const onUseFont = vi.fn();
  const onUseColor = vi.fn();
  const onUseLogo = vi.fn();
  setup({ onUseFont, onUseColor, onUseLogo });
  fireEvent.click(screen.getByRole("button", { name: "Add subtitle" }));
  fireEvent.click(screen.getByRole("button", { name: "#ff5a1f" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Solvers logo" }));
  expect(onUseFont).toHaveBeenCalledWith("subtitle");
  expect(onUseColor).toHaveBeenCalledWith("#ff5a1f");
  expect(onUseLogo).toHaveBeenCalledWith(logo);
});

it("choosing a font saves only that role", () => {
  const { save } = setup();
  fireEvent.change(screen.getByLabelText("Title font"), { target: { value: "Bebas Neue" } });
  expect(save).toHaveBeenCalledWith({ titleFont: "Bebas Neue" });
});

it("adding a color saves the list with it appended", () => {
  const { save } = setup();
  fireEvent.change(screen.getByLabelText("New color"), { target: { value: "#FFAA00" } });
  fireEvent.click(screen.getByRole("button", { name: "Add color" }));
  expect(save).toHaveBeenCalledWith({ colors: ["#ff5a1f", "#111111", "#ffaa00"] });
});

it("a color can be added with Enter, and from the color picker", () => {
  const { save } = setup();
  fireEvent.change(screen.getByLabelText("Pick a color"), { target: { value: "#00ff00" } });
  expect((screen.getByLabelText("New color") as HTMLInputElement).value).toBe("#00ff00");
  fireEvent.keyDown(screen.getByLabelText("New color"), { key: "Enter" });
  expect(save).toHaveBeenCalledWith({ colors: ["#ff5a1f", "#111111", "#00ff00"] });
});

it("a bad hex is not saved and says why", () => {
  const { save } = setup();
  fireEvent.change(screen.getByLabelText("New color"), { target: { value: "orange" } });
  fireEvent.click(screen.getByRole("button", { name: "Add color" }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText("Use a hex color like #ff5a1f.")).toBeTruthy();
});

it("removing a color or a logo saves the kit without it", () => {
  const { save } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Remove #111111" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove Solvers logo from the kit" }));
  expect(save).toHaveBeenNthCalledWith(1, { colors: ["#ff5a1f"] });
  expect(save).toHaveBeenNthCalledWith(2, { logoAssetIds: [] });
});

it("Add logo asks for one", () => {
  const onAddLogo = vi.fn();
  setup({ onAddLogo });
  fireEvent.click(screen.getByRole("button", { name: "Add logo" }));
  expect(onAddLogo).toHaveBeenCalled();
});

it("a viewer sees the kit with nothing to change", () => {
  setup({ canEdit: false });
  expect(screen.queryByLabelText("Title font")).toBeNull();
  expect(screen.queryByLabelText("New color")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add logo" })).toBeNull();
  const fonts = screen.getByRole("region", { name: "Fonts" });
  expect(within(fonts).getByText("Orbitron")).toBeTruthy();
  expect(screen.getByTitle("#ff5a1f")).toBeTruthy();
});

it("the color controls go away at 24 colors", () => {
  setup({ kit: { ...KIT, colors: Array.from({ length: 24 }, (_, i) => `#${(i + 1).toString(16).padStart(6, "0")}`) } });
  expect(screen.queryByLabelText("New color")).toBeNull();
});

it("a hidden remove badge takes no clicks, so clicking a swatch or logo never removes it", () => {
  setup({ onUseColor: vi.fn(), onUseLogo: vi.fn() });
  for (const name of ["Remove #ff5a1f", "Remove Solvers logo from the kit"]) {
    const badge = screen.getByRole("button", { name });
    const classes = badge.className.split(/\s+/);
    expect(classes, name).toContain("pointer-events-none"); // until the tile is hovered or the badge is focused
    expect(classes, name).toContain("group-hover:pointer-events-auto");
    expect(classes, name).not.toContain("size-7"); // a 20 px badge on the corner, not a button over the swatch
  }
});
