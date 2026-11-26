// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { MediaProvider } from "@/components/editor/media/media-context";
import { findClip } from "@/lib/editor/store";
import type { TextClip, TimelineDoc } from "@/lib/timeline";
import { makeStore, sampleDoc, text } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen, within } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";
import { openEverySection } from "../helpers/folds";

// These tests are about what the sections hold, so every section starts open.
beforeEach(openEverySection);

afterEach(cleanup);

// x1 says "the big robot", in Geist at 400.
function titled(): TimelineDoc {
  const d = sampleDoc();
  const base = text("x1", 0, 60, { text: "the big robot" }) as TextClip;
  d.tracks[1].clips = [{ ...base, style: { ...base.style, fontWeight: 400 } }];
  return d;
}
function show(canEdit = true) {
  const store = makeStore({ doc: titled(), canEdit });
  store.getState().select(["x1"]);
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices([assetView()])}>
        <Inspector />
      </MediaProvider>
    </EditorProvider>,
  );
  const clip = () => findClip(store.getState().doc, "x1")!.clip as TextClip;
  const box = () => screen.getByRole("textbox", { name: "Text" }) as HTMLTextAreaElement;
  const pick = (from: number, to: number) => {
    box().setSelectionRange(from, to);
    fireEvent.select(box());
  };
  const group = () => within(screen.getByRole("group", { name: "Text style" }));
  const button = (name: string) => group().getByRole("button", { name }) as HTMLButtonElement;
  return { store, clip, box, pick, group, button };
}

it("with no words selected, styles the whole text: one Bold, Italic and Underline row, not a second set of switches", () => {
  const { clip, button, group } = show();
  expect(["Bold", "Italic", "Underline", "All plain"].map((name) => button(name).disabled)).toEqual([false, false, false, true]);
  expect(group().getByText(/Changes the whole text/)).toBeTruthy();
  expect(group().queryByLabelText("Color of the selected words")).toBeNull();
  expect(screen.queryByRole("switch", { name: "Italic" })).toBeNull();
  // The text is at 400: Bold goes to the font's bold weight and back to regular.
  expect(button("Bold").getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(button("Bold"));
  expect(clip().style.fontWeight).toBe(700);
  expect(button("Bold").getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button("Bold"));
  expect(clip().style.fontWeight).toBe(400);
  fireEvent.click(button("Italic"));
  fireEvent.click(button("Underline"));
  expect([clip().style.italic, clip().style.underline, clip().spans ?? null]).toEqual([true, true, null]);
  expect(button("Italic").getAttribute("aria-pressed")).toBe("true");
});

it("makes the selected words bold, shows that they are, and makes them plain again", () => {
  const { store, clip, pick, button, group } = show();
  pick(4, 7);
  expect(group().getByText("Changes only the words selected in the box above.")).toBeTruthy();
  expect(button("Bold").getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(button("Bold"));
  expect(clip().spans).toEqual([{ from: 4, to: 7, fontWeight: 700 }]);
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "text style" });
  expect(button("Bold").getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button("Italic"));
  fireEvent.click(button("Underline"));
  expect(clip().spans).toEqual([{ from: 4, to: 7, fontWeight: 700, italic: true, underline: true }]);
  fireEvent.click(button("Bold"));
  expect(clip().spans).toEqual([{ from: 4, to: 7, italic: true, underline: true }]);
  fireEvent.click(button("Plain"));
  expect(clip().spans).toBeNull();
});

it("gives the selected words a colour of their own, by its hex", () => {
  const { clip, pick, group } = show();
  pick(8, 13);
  const hex = group().getByLabelText("Color of the selected words hex") as HTMLInputElement;
  expect(hex.value).toBe("#ffffff"); // the clip's own, to start from
  fireEvent.change(hex, { target: { value: "#ff0000" } });
  fireEvent.blur(hex);
  expect(clip().spans).toEqual([{ from: 8, to: 13, color: "#ff0000" }]);
});

it("keeps the look on its words when the text is retyped, and says how many stretches are styled", () => {
  const { clip, box, pick, button, group } = show();
  pick(4, 7);
  fireEvent.click(button("Bold"));
  fireEvent.change(box(), { target: { value: "see the big robot" } });
  fireEvent.blur(box());
  expect([clip().text, clip().spans]).toEqual(["see the big robot", [{ from: 8, to: 11, fontWeight: 700 }]]);
  // Nothing is selected now: the buttons are for the whole text, and All plain clears every stretch.
  act(() => {
    box().setSelectionRange(0, 0);
    fireEvent.select(box());
  });
  expect(group().getByText("1 stretch has a look of its own. Select words above to change them.")).toBeTruthy();
  expect(button("Bold").disabled).toBe(false);
  fireEvent.click(button("All plain"));
  expect(clip().spans).toBeNull();
});

it("is off for someone who can't edit", () => {
  const { pick, button } = show(false);
  pick(4, 7);
  expect(["Bold", "Italic", "Underline"].map((name) => button(name).disabled)).toEqual([true, true, true]);
});
