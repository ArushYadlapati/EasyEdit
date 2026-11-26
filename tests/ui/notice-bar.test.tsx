// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { NOTICE_MS, NoticeBar } from "@/components/editor/notice-bar";
import { makeStore } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen } from "../helpers/dom";

afterEach(() => vi.restoreAllMocks());

function show(href: string, setup?: (store: ReturnType<typeof makeStore>) => void) {
  const store = makeStore();
  setup?.(store);
  render(<EditorProvider store={store}><NoticeBar /></EditorProvider>);
  act(() => store.getState().notify("info", "Saved.", { label: "See templates", href }));
  return store;
}

it("the notice's link leaves the editor the way LeaveLink does: a real page load when edits cannot be sent", () => {
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  show("/s/crew/settings/templates", (store) => {
    store.getState().edit([{ op: "move_clip", clipId: "x2", start: 100 }], "move");
    store.getState().setStatus("offline");
  });
  const link = screen.getByRole("link", { name: "See templates" });
  expect(link.getAttribute("href")).toBe("/s/crew/settings/templates");
  expect(fireEvent.click(link)).toBe(false);
  expect(assign).toHaveBeenCalledWith("/s/crew/settings/templates");
});

it("stays inside the app when nothing is at risk", () => {
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  show("/s/crew/settings/templates");
  expect(fireEvent.click(screen.getByRole("link", { name: "See templates" }))).toBe(true);
  expect(assign).not.toHaveBeenCalled();
});

it("an error is said in the danger color, with no stripe down the notice's side", () => {
  const store = makeStore();
  render(<EditorProvider store={store}><NoticeBar /></EditorProvider>);
  act(() => store.getState().notify("error", "That clip is gone."));
  const words = screen.getByRole("alert");
  expect(words.textContent).toBe("That clip is gone.");
  expect(words.className.split(" ")).toContain("text-ed-danger");
  const frame = words.parentElement!;
  expect(frame.className.split(" ").filter((c) => c.startsWith("border-l"))).toEqual([]);
  expect(frame.className.split(" ")).toEqual(expect.arrayContaining(["border", "border-ed-line", "bg-ed-raised"]));
  act(() => store.getState().notify("info", "Saved."));
  expect(screen.getByRole("status").textContent).toBe("Saved.");
  expect(screen.getByRole("status").className).not.toContain("text-ed-danger");
  expect(screen.getByRole("alert").textContent).toBe("");
});

it("a notice that says the same as the one showing is new words in its live region, so it is announced again", () => {
  const store = makeStore();
  render(<EditorProvider store={store}><NoticeBar /></EditorProvider>);
  const alert = screen.getByRole("alert");
  const status = screen.getByRole("status");
  act(() => store.getState().notify("error", "That track is locked."));
  const first = alert.firstChild!;
  act(() => store.getState().notify("error", "That track is locked.")); // the retry is refused too
  expect(alert.textContent).toBe("That track is locked.");
  expect(alert.firstChild).not.toBe(first);
  expect(first.isConnected).toBe(false);
  expect(screen.getByRole("alert")).toBe(alert); // the region itself stays, only the words in it are new
  act(() => store.getState().notify("info", "Saved."));
  const saved = status.firstChild!;
  act(() => store.getState().notify("info", "Saved."));
  expect(status.textContent).toBe("Saved.");
  expect(status.firstChild).not.toBe(saved);
  expect(screen.getByRole("status")).toBe(status);
});

it("shows no link for an address outside this app", () => {
  for (const href of ["https://evil.example/", "//evil.example/", "javascript:alert(1)"]) {
    const store = show(href);
    expect(screen.queryByRole("link", { name: "See templates" })).toBeNull();
    expect(store.getState().notice?.text).toBe("Saved.");
    cleanup();
  }
});

describe("how long a notice stays", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  // The bar with a button outside it, for focus to go to.
  function mount() {
    const store = makeStore();
    render(
      <EditorProvider store={store}>
        <button type="button">Elsewhere</button>
        <NoticeBar />
      </EditorProvider>,
    );
    return store;
  }
  const frame = () => screen.getByRole("status").parentElement!;
  const link = { label: "See templates", href: "/s/crew/settings/templates" };

  it("an info notice goes after five seconds", () => {
    const store = mount();
    act(() => store.getState().notify("info", "Saved."));
    wait(NOTICE_MS - 1);
    expect(screen.getByRole("status").textContent).toBe("Saved.");
    wait(1);
    expect(store.getState().notice).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("waits while the pointer is over the notice, and counts five full seconds once it leaves", () => {
    const store = mount();
    act(() => store.getState().notify("info", "Saved.", link));
    wait(4000);
    fireEvent.pointerEnter(frame());
    wait(60_000);
    expect(screen.getByRole("status").textContent).toBe("Saved.");
    fireEvent.pointerLeave(frame());
    wait(NOTICE_MS - 1);
    expect(store.getState().notice?.text).toBe("Saved.");
    wait(1);
    expect(store.getState().notice).toBeNull();
  });

  it("waits while focus is in the notice, moving from its link to Dismiss, and counts again once focus leaves", () => {
    const store = mount();
    act(() => store.getState().notify("info", "Saved.", link));
    wait(4000);
    act(() => screen.getByRole("link", { name: "See templates" }).focus());
    wait(60_000);
    act(() => screen.getByRole("button", { name: "Dismiss" }).focus());
    wait(60_000);
    expect(screen.getByRole("status").textContent).toBe("Saved.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dismiss" }));
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    wait(NOTICE_MS - 1);
    expect(store.getState().notice?.text).toBe("Saved.");
    wait(1);
    expect(store.getState().notice).toBeNull();
  });

  it("waits while either the pointer or focus is still there", () => {
    const store = mount();
    act(() => store.getState().notify("info", "Saved.", link));
    fireEvent.pointerEnter(frame());
    act(() => screen.getByRole("link", { name: "See templates" }).focus());
    fireEvent.pointerLeave(frame());
    wait(60_000);
    expect(store.getState().notice?.text).toBe("Saved.");
    fireEvent.pointerEnter(frame());
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    wait(60_000);
    expect(store.getState().notice?.text).toBe("Saved.");
    fireEvent.pointerLeave(frame());
    wait(NOTICE_MS);
    expect(store.getState().notice).toBeNull();
  });

  it("the link's own question, asked while an export runs, keeps the notice and itself on screen", () => {
    const store = mount();
    act(() => {
      store.getState().setExporting(true);
      store.getState().notify("info", "Saved.", link);
    });
    const see = screen.getByRole("link", { name: "See templates" });
    act(() => see.focus());
    expect(fireEvent.click(see)).toBe(false);
    act(() => screen.getByRole("button", { name: "Stay" }).focus());
    wait(60_000);
    expect(screen.getByText("Leave the editor?", { selector: "h2" })).toBeTruthy();
    expect(store.getState().notice?.text).toBe("Saved.");
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    act(() => see.focus()); // a browser gives focus back to the link when its question closes; happy-dom doesn't
    wait(60_000);
    expect(store.getState().notice?.text).toBe("Saved.");
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    wait(NOTICE_MS);
    expect(store.getState().notice).toBeNull();
  });

  it("a pointer that was on the link's question has left once it is over something else", () => {
    const store = mount();
    act(() => {
      store.getState().setExporting(true);
      store.getState().notify("info", "Saved.", link);
    });
    fireEvent.pointerEnter(frame());
    expect(fireEvent.click(screen.getByRole("link", { name: "See templates" }))).toBe(false);
    const stay = screen.getByRole("button", { name: "Stay" });
    fireEvent.pointerOver(stay);
    fireEvent.click(stay); // the question closes under the pointer, which gets no leave from what was taken away
    expect(screen.queryByText("Leave the editor?", { selector: "h2" })).toBeNull();
    wait(60_000);
    expect(store.getState().notice?.text).toBe("Saved.");
    fireEvent.pointerOver(screen.getByRole("button", { name: "Elsewhere" }));
    wait(NOTICE_MS - 1);
    expect(store.getState().notice?.text).toBe("Saved.");
    wait(1);
    expect(store.getState().notice).toBeNull();
  });

  it("an error stays until it is dismissed", () => {
    const store = mount();
    act(() => store.getState().notify("error", "That clip is gone."));
    wait(10 * 60_000);
    expect(screen.getByRole("alert").textContent).toBe("That clip is gone.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(store.getState().notice).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("an error gives way to a newer notice, which counts its own five seconds", () => {
    const store = mount();
    act(() => store.getState().notify("error", "That clip is gone."));
    wait(60_000);
    act(() => store.getState().notify("info", "Saved."));
    expect(screen.getByRole("alert").textContent).toBe("");
    expect(screen.getByRole("status").textContent).toBe("Saved.");
    wait(NOTICE_MS);
    expect(store.getState().notice).toBeNull();
  });

  it("a newer notice takes the place of the current one at once, with five full seconds of its own", () => {
    const store = mount();
    act(() => store.getState().notify("info", "Saved."));
    wait(4000);
    act(() => store.getState().notify("info", "Export saved as Qual recap.mp4."));
    expect(screen.getByRole("status").textContent).toBe("Export saved as Qual recap.mp4.");
    wait(NOTICE_MS - 1);
    expect(store.getState().notice?.text).toBe("Export saved as Qual recap.mp4.");
    wait(1);
    expect(store.getState().notice).toBeNull();
  });

  it("a newer notice that arrives under the pointer waits too", () => {
    const store = mount();
    act(() => store.getState().notify("info", "Saved."));
    fireEvent.pointerEnter(frame());
    act(() => store.getState().notify("info", "Export saved as Qual recap.mp4."));
    wait(60_000);
    expect(store.getState().notice?.text).toBe("Export saved as Qual recap.mp4.");
    fireEvent.pointerLeave(frame());
    wait(NOTICE_MS);
    expect(store.getState().notice).toBeNull();
  });

  it("focus that went with an older notice's link doesn't hold the next one", () => {
    const store = mount();
    act(() => store.getState().notify("info", "Saved.", link));
    act(() => screen.getByRole("link", { name: "See templates" }).focus());
    act(() => store.getState().notify("info", "Export saved as Qual recap.mp4."));
    expect(screen.queryByRole("link", { name: "See templates" })).toBeNull();
    wait(NOTICE_MS);
    expect(store.getState().notice).toBeNull();
  });

  it("after Dismiss, the next notice counts its five seconds", () => {
    const store = mount();
    act(() => store.getState().notify("error", "That clip is gone."));
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    fireEvent.pointerEnter(frame());
    act(() => dismiss.focus());
    fireEvent.click(dismiss);
    act(() => store.getState().notify("info", "Saved."));
    wait(NOTICE_MS);
    expect(store.getState().notice).toBeNull();
  });
});

it("below the lg width the notice takes the preview's grid row across the window, not the strip between the desktop panels", () => {
  const store = makeStore();
  const { container } = render(<EditorProvider store={store}><NoticeBar /></EditorProvider>);
  act(() => store.getState().notify("info", "Nothing to split at the playhead."));
  const layer = (container.firstElementChild as HTMLElement).className.split(" ");
  // The desktop place stays as it was; the phone's overrides it from the preview's row: across, with 8 px a side,
  // at the foot of the preview, just above the Timeline / Add / Details switch.
  expect(layer).toEqual(expect.arrayContaining(["left-[calc(var(--ed-left-w)+1px)]", "bottom-[calc(var(--ed-timeline-h)+9px)]"]));
  expect(layer).toEqual(expect.arrayContaining(["max-lg:left-0", "max-lg:right-0", "max-lg:row-start-2", "max-lg:row-end-3", "max-lg:px-2", "max-lg:bottom-2"]));
});
