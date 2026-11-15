// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { BrandProvider, useBrand } from "@/components/editor/brand/brand-context";
import { DEFAULT_BRAND_KIT, type BrandKit } from "@/lib/brand/types";
import { act, render, screen, waitFor } from "../helpers/dom";

const kit = (over: Partial<BrandKit> = {}): BrandKit => ({ ...DEFAULT_BRAND_KIT, ...over });

function Show() {
  const brand = useBrand();
  return (
    <div>
      <p data-testid="title">{brand.kit.fonts.title}</p>
      <p data-testid="loaded">{String(brand.loaded)}</p>
      <button onClick={() => void brand.save({ titleFont: "Orbitron" })}>save</button>
    </div>
  );
}

it("the kit loads once for the space", async () => {
  const fetch = vi.fn(async () => kit({ fonts: { title: "Inter", subtitle: "Geist", body: "Geist" } }));
  render(<BrandProvider spaceId="team1" canEdit api={{ fetch, save: vi.fn() }}><Show /></BrandProvider>);
  await waitFor(() => expect(screen.getByTestId("title").textContent).toBe("Inter"));
  expect(screen.getByTestId("loaded").textContent).toBe("true");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("team1");
});

it("a save shows at once and keeps the server's answer", async () => {
  const save = vi.fn(async () => kit({ fonts: { title: "Orbitron", subtitle: "Geist", body: "Geist" }, updatedAt: "2026-11-15T00:00:00.000Z" }));
  render(<BrandProvider spaceId="team1" canEdit initial={kit()} api={{ fetch: vi.fn(), save }}><Show /></BrandProvider>);
  await act(async () => screen.getByText("save").click());
  expect(screen.getByTestId("title").textContent).toBe("Orbitron");
  expect(save).toHaveBeenCalledWith("team1", { titleFont: "Orbitron" });
});

it("a failed save rolls back", async () => {
  const onError = vi.fn();
  const save = vi.fn(async () => { throw new Error("No"); });
  render(<BrandProvider spaceId="team1" canEdit initial={kit()} onError={onError} api={{ fetch: vi.fn(), save }}><Show /></BrandProvider>);
  await act(async () => screen.getByText("save").click());
  expect(screen.getByTestId("title").textContent).toBe("Geist");
  expect(onError).toHaveBeenCalledWith("No");
});

it("without a provider the kit is the default one", () => {
  render(<Show />);
  expect(screen.getByTestId("title").textContent).toBe("Geist");
});
