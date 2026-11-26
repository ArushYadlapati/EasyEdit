// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { StockDialog, type StockDeps } from "@/components/editor/media/stock-dialog";
import type { StockSearch } from "@/lib/stock/client";
import { STOCK_MESSAGES, type StockItem, type StockKind } from "@/lib/stock/types";
import { act, cleanup, fireEvent, render, screen, within } from "../helpers/dom";

afterEach(cleanup);

const item = (id: string, kind: StockKind = "video", by = "Ana"): StockItem => ({ id, kind, width: 1280, height: 720, seconds: kind === "video" ? 75 : null, thumb: `https://images.pexels.com/${id}.jpg`, file: `https://videos.pexels.com/${id}.mp4`, fileName: `clip-pexels-${id}.mp4`, by, byUrl: "https://www.pexels.com/@ana", page: null });
const flush = () => act(async () => {});

function show(answer: (kind: StockKind, query: string, page: number) => StockSearch = (kind) => ({ ok: true, result: { on: true, items: [item("1", kind), item("2", kind, "Ben")], more: true } })) {
  const search = vi.fn(async (kind: StockKind, query: string, page: number) => answer(kind, query, page));
  const file = vi.fn<StockDeps["file"]>(async (it) => new File(["x"], it.fileName, { type: "video/mp4" }));
  const onAdd = vi.fn<(file: File) => void>();
  const onClose = vi.fn();
  const view = render(<StockDialog open onClose={onClose} onAdd={onAdd} deps={{ search, file }} />);
  const asked = () => search.mock.calls.map(([kind, query, page]) => [kind, query, page]);
  const tiles = () => screen.queryAllByRole("listitem");
  return { search, file, onAdd, onClose, asked, tiles, view };
}

it("opens on what is popular: a grid of pictures with each one's length and maker", async () => {
  const { asked, tiles } = show();
  expect(screen.getByRole("status").textContent).toBe("Searching…");
  await flush();
  expect(asked()).toEqual([["video", "", 1]]);
  expect(screen.getByRole("status").textContent).toBe("Popular now");
  expect(tiles()).toHaveLength(2);
  expect(tiles()[0].textContent).toContain("1:15");
  expect(within(tiles()[1]).getByRole("link", { name: "Ben" }).getAttribute("rel")).toBe("noreferrer noopener");
  expect(tiles()[0].querySelector("img")!.getAttribute("referrerpolicy")).toBe("no-referrer");
});

it("searches for the words sent, and for photos when the kind changes", async () => {
  const { asked } = show();
  await flush();
  fireEvent.change(screen.getByRole("textbox", { name: "Search stock videos and photos" }), { target: { value: " robot arm " } });
  expect(asked()).toHaveLength(1); // typing alone asks nothing
  fireEvent.submit(screen.getByRole("search"));
  await flush();
  expect(asked()[1]).toEqual(["video", "robot arm", 1]);
  expect(screen.getByRole("status").textContent).toBe("Results for “robot arm”");
  fireEvent.click(screen.getByRole("radio", { name: "Photos" }));
  await flush();
  expect(asked()[2]).toEqual(["image", "robot arm", 1]);
});

it("Show more adds the next page under the first, without repeats", async () => {
  const { asked, tiles } = show((kind, _query, page) => ({ ok: true, result: { on: true, items: page === 1 ? [item("1", kind), item("2", kind)] : [item("2", kind), item("3", kind)], more: page === 1 } }));
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  await flush();
  expect(asked()[1]).toEqual(["video", "", 2]);
  expect(tiles()).toHaveLength(3);
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
});

it("Add gets the file and hands it over, and the dialog stays open for the next", async () => {
  const { file, onAdd, onClose } = show();
  await flush();
  const add = screen.getByRole("button", { name: "Add the video by Ben to the library" }) as HTMLButtonElement;
  fireEvent.click(add);
  expect(add.textContent).toBe("Getting…");
  await flush();
  expect(file.mock.calls[0][0]).toMatchObject({ id: "2" });
  expect(onAdd.mock.calls.map(([f]) => f.name)).toEqual(["clip-pexels-2.mp4"]);
  expect([add.textContent, add.disabled]).toEqual(["Added", true]);
  expect(onClose).not.toHaveBeenCalled();
});

it("says so when a file can't be had, and lets it be tried again", async () => {
  const { file, onAdd } = show();
  file.mockResolvedValueOnce(null);
  await flush();
  const add = screen.getByRole("button", { name: "Add the video by Ana to the library" }) as HTMLButtonElement;
  fireEvent.click(add);
  await flush();
  expect(screen.getByRole("alert").textContent).toBe(STOCK_MESSAGES.fileFailed);
  expect([add.textContent, add.disabled, onAdd.mock.calls.length]).toEqual(["Try again", false, 0]);
  fireEvent.click(add);
  await flush();
  expect(onAdd).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("says so when nothing is found, and when the search fails", async () => {
  const none = show(() => ({ ok: true, result: { on: true, items: [], more: false } }));
  await flush();
  expect(screen.getByRole("status").textContent).toBe(STOCK_MESSAGES.none);
  none.view.unmount();
  show(() => ({ ok: false, message: STOCK_MESSAGES.busy }));
  await flush();
  expect(screen.getByRole("status").textContent).toBe(STOCK_MESSAGES.busy);
});

it("credits Pexels", async () => {
  show();
  await flush();
  expect(screen.getByRole("link", { name: "Pexels" }).getAttribute("href")).toBe("https://www.pexels.com");
});
