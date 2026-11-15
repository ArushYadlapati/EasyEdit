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

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Colors() {
  const brand = useBrand();
  return (
    <div>
      <p data-testid="colors">{brand.kit.colors.join(",")}</p>
      <p data-testid="can-edit">{String(brand.canEdit)}</p>
      {brand.error && <p data-testid="error">{brand.error}</p>}
      <button onClick={() => void brand.save({ colors: brand.kit.colors.filter((c) => c !== "#000001") })}>drop 1</button>
      <button onClick={() => void brand.save({ colors: brand.kit.colors.filter((c) => c !== "#000002") })}>drop 2</button>
      <button onClick={() => brand.retry()}>retry</button>
    </div>
  );
}

const three = kit({ colors: ["#000001", "#000002", "#000003"] });

it("saves go to the server one at a time, in order, and the last answer stands", async () => {
  const first = deferred<BrandKit>();
  const second = deferred<BrandKit>();
  const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(<BrandProvider spaceId="team1" canEdit initial={three} api={{ fetch: vi.fn(), save }}><Colors /></BrandProvider>);
  await act(async () => screen.getByText("drop 1").click());
  await act(async () => screen.getByText("drop 2").click());
  expect(screen.getByTestId("colors").textContent).toBe("#000003");
  expect(save).toHaveBeenCalledTimes(1); // the second waits for the first
  await act(async () => first.resolve(kit({ colors: ["#000002", "#000003"] })));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith("team1", { colors: ["#000003"] });
  expect(screen.getByTestId("colors").textContent).toBe("#000003"); // the first answer doesn't bring #000002 back
  await act(async () => second.resolve(kit({ colors: ["#000003"] })));
  expect(screen.getByTestId("colors").textContent).toBe("#000003");
});

it("a refused save undoes only itself, not a later one", async () => {
  const first = deferred<BrandKit>();
  const second = deferred<BrandKit>();
  const onError = vi.fn();
  const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(<BrandProvider spaceId="team1" canEdit initial={three} onError={onError} api={{ fetch: vi.fn(), save }}><Colors /></BrandProvider>);
  await act(async () => screen.getByText("drop 1").click());
  await act(async () => screen.getByText("drop 2").click());
  await act(async () => first.reject(new Error("No")));
  expect(onError).toHaveBeenCalledWith("No");
  expect(screen.getByTestId("colors").textContent).toBe("#000003"); // the later change still shows while it is sent
  await act(async () => second.resolve(kit({ colors: ["#000003"] })));
  expect(screen.getByTestId("colors").textContent).toBe("#000003");
});

it("nothing can be changed until the kit has loaded, and a failed load says so and can be retried", async () => {
  const load = deferred<BrandKit>();
  const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(load.promise);
  render(<BrandProvider spaceId="team1" canEdit api={{ fetch, save: vi.fn() }}><Colors /></BrandProvider>);
  expect(screen.getByTestId("can-edit").textContent).toBe("false");
  await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("The brand kit couldn't be loaded."));
  expect(screen.getByTestId("can-edit").textContent).toBe("false");
  await act(async () => screen.getByText("retry").click());
  await act(async () => load.resolve(three));
  expect(screen.getByTestId("can-edit").textContent).toBe("true");
  expect(screen.queryByTestId("error")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});
