// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { EditingIndicator } from "@/components/editor/editing-indicator";
import { EditorProvider } from "@/components/editor/context";
import { peerLook } from "@/components/editor/peer-look";
import { PresenceProvider } from "@/components/editor/presence-context";
import { createPresenceStore, type PeerWire } from "@/lib/editor/presence";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, screen } from "../helpers/dom";

const peer = (userId: string, name: string, clipIds: string[] = [], trackId: string | null = null): PeerWire =>
  ({ userId, name, clipIds, trackId });

// The top bar's indicator for Ada (u1) on the sample doc, with these teammates listed by the last check.
function renderWith(list: PeerWire[]) {
  const store = makeStore();
  const presence = createPresenceStore("u1");
  if (list.length > 0) presence.getState().receive(list, Date.now());
  const view = render(
    <EditorProvider store={store}>
      <PresenceProvider store={presence}>
        <EditingIndicator />
      </PresenceProvider>
    </EditorProvider>,
  );
  return { store, presence, ...view };
}

const group = () => screen.queryByRole("group", { name: "Also here" });
const colourOf = (presence: ReturnType<typeof createPresenceStore>, userId: string) =>
  presence.getState().peers.find((p) => p.userId === userId)!.colour;

it("shows a dot per teammate with their initials and colour, after a You dot in your own colour", () => {
  const { presence } = renderWith([peer("u2", "Grace Hopper"), peer("u3", "Linus")]);
  expect(group()).not.toBeNull();
  const dots = group()!.querySelectorAll("[role=img], button");
  expect([...dots].map((d) => d.getAttribute("title"))).toEqual(["You", "Grace Hopper, nothing selected", "Linus, nothing selected"]);
  expect(dots[0].className).toContain(peerLook(presence.getState().meColour!).bg);
  expect(dots[1].textContent).toBe("GH");
  expect(dots[1].className).toContain(peerLook(colourOf(presence, "u2")).bg);
  expect(dots[2].textContent).toBe("L");
  expect(dots[2].className).toContain(peerLook(colourOf(presence, "u3")).bg);
});

it("folds a fourth person and beyond into a +N dot that lists their names", () => {
  renderWith([peer("u2", "Ada Lovelace"), peer("u3", "Barbara Liskov"), peer("u4", "Grace Hopper"), peer("u5", "Linus"), peer("u6", "Margaret Hamilton")]);
  const more = screen.getByRole("img", { name: "Linus, Margaret Hamilton" });
  expect(more.textContent).toBe("+2");
  expect(more.getAttribute("title")).toBe("Linus, Margaret Hamilton");
  expect(screen.queryByTitle("Linus, nothing selected")).toBeNull();
  expect(screen.getByTitle("Grace Hopper, nothing selected")).toBeTruthy();
});

it("a dot is a button only when the teammate has clips that exist here, labelled with how many", () => {
  renderWith([peer("u2", "Grace Hopper", ["x2", "c2", "gone"]), peer("u3", "Linus", ["gone"])]);
  const go = screen.getByRole("button", { name: "Go to Grace Hopper's selection (2 clips)" });
  expect(go.getAttribute("title")).toBe("Go to Grace Hopper's selection (2 clips)");
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("img", { name: "Linus, nothing selected" })).toBeTruthy();
});

it("a teammate with a track or nothing selected gets a span saying so", () => {
  renderWith([peer("u2", "Grace Hopper", [], "t1"), peer("u3", "Linus")]);
  const track = screen.getByRole("img", { name: "Grace Hopper, Text 1 track selected" });
  expect(track.tagName).toBe("SPAN");
  expect(track.getAttribute("title")).toBe("Grace Hopper, Text 1 track selected");
  expect(screen.getByRole("img", { name: "Linus, nothing selected" }).tagName).toBe("SPAN");
});

it("a click moves the playhead to the earliest selected clip and leaves your selection unchanged", () => {
  const { store } = renderWith([peer("u2", "Grace Hopper", ["x2", "c2"])]);
  act(() => store.getState().select(["x1"]));
  const before = store.getState().selection;
  fireEvent.click(screen.getByRole("button", { name: "Go to Grace Hopper's selection (2 clips)" }));
  expect(store.getState().playhead).toBe(30);
  expect(store.getState().selection).toBe(before);
});

it("shows nothing when nobody else is here", () => {
  const { container, presence } = renderWith([]);
  expect(group()).toBeNull();
  expect(container.textContent).toBe("");
  act(() => presence.getState().receive([peer("u2", "Grace Hopper")], Date.now()));
  expect(group()).not.toBeNull();
  act(() => presence.getState().forget());
  expect(group()).toBeNull();
});

it("the dots show with no recent edit, and 'is editing…' still shows beside them", () => {
  const { store } = renderWith([peer("u2", "Grace Hopper")]);
  expect(group()).not.toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  act(() => store.setState({ remote: { names: ["Grace Hopper"], at: Date.now() } }));
  expect(screen.getByRole("status").textContent).toBe("Grace Hopper is editing…");
  expect(group()).not.toBeNull();
});
