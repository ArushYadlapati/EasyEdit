// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { peerLook, PEER_MORE } from "@/components/editor/peer-look";
import { PresenceProvider } from "@/components/editor/presence-context";
import { cx } from "@/components/ui/cx";
import { deleteSelection } from "@/lib/editor/actions";
import { CLIP_HEIGHT } from "@/components/editor/timeline/clip-view";
import { ROW_HEIGHT, RULER_HEIGHT } from "@/lib/editor/geometry";
import { createPresenceStore, type PeerWire } from "@/lib/editor/presence";
import { act, screen } from "../helpers/dom";
import { makeStore, sampleDoc, text } from "../editor/fixtures";
import { ZOOM, installTimelineStubs, renderTimeline, x, y } from "../helpers/timeline-harness";

// The real cx; the spy only counts calls. ClipView calls it once per render with its fill class, and TrackHeader with
// its sticky header classes, which nothing else on the timeline uses.
vi.mock("@/components/ui/cx", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/cx")>();
  return { ...real, cx: vi.fn(real.cx) };
});

installTimelineStubs();

// Rows top to bottom: cap, t1, v1, a1. t1 holds x1 (0-60) and x2 (90-120).
const T1 = 1;
const grace: PeerWire = { userId: "u2", name: "Grace Hopper", clipIds: ["x2"], trackId: null };
const lin: PeerWire = { userId: "u3", name: "Lin Lanying", clipIds: ["x2"], trackId: null };
const mary: PeerWire = { userId: "u4", name: "Mary Jackson", clipIds: ["x2"], trackId: null };

function setup(list: PeerWire[], store = makeStore()) {
  const presence = createPresenceStore("u1");
  act(() => presence.getState().receive(list, 0));
  const wrap = (timeline: ReactNode) => <PresenceProvider store={presence}>{timeline}</PresenceProvider>;
  const harness = renderTimeline(store, { wrap });
  const rings = () => [...harness.view.container.querySelectorAll<HTMLElement>("[data-peer-clip]")];
  const bands = () => [...harness.view.container.querySelectorAll<HTMLElement>("[data-peer-track]")];
  const peer = (userId: string) => presence.getState().peers.find((p) => p.userId === userId)!;
  const receive = (next: PeerWire[]) => act(() => presence.getState().receive(next, 1));
  return { ...harness, presence, rings, bands, peer, receive };
}

const box = (el: HTMLElement) => ({
  left: parseFloat(el.style.left),
  top: parseFloat(el.style.top),
  width: parseFloat(el.style.width),
  height: parseFloat(el.style.height),
});

it("the ring sits 2 px outside the clip at x() and y(), at z-10", () => {
  const { rings, peer } = setup([grace]);
  expect(rings()).toHaveLength(1);
  const ring = rings()[0];
  const { left, top, width, height } = box(ring);
  expect(left).toBe(x(90) - 2);
  expect(width).toBe(30 * ZOOM + 4);
  expect(height).toBe(CLIP_HEIGHT + 4);
  expect(RULER_HEIGHT + top + height / 2).toBe(y(T1)); // centred on t1's row, as the clip is
  expect(ring.className).toContain("z-10");
  expect(ring.className).toContain("pointer-events-none");
  expect(ring.className).toContain("rounded-[6px]");
  expect(ring.className).toContain(peerLook(peer("u2").colour).border);
  expect(ring.className).not.toContain("overflow-hidden");
  expect(ring.getAttribute("aria-hidden")).toBe("true");
});

it("a second person gets a ring 4 px out", () => {
  const { rings, peer } = setup([grace, lin]);
  expect(rings()).toHaveLength(2);
  const [first, second] = rings().map(box);
  expect(second.left).toBe(x(90) - 4);
  expect(second.width).toBe(30 * ZOOM + 8);
  expect(second.height).toBe(CLIP_HEIGHT + 8);
  expect(second.top).toBe(first.top - 2);
  expect(second.top).toBeGreaterThanOrEqual(T1 * ROW_HEIGHT); // still inside its 40 px row
  expect(second.top + second.height).toBeLessThanOrEqual((T1 + 1) * ROW_HEIGHT);
  // Peers are in name order: Grace first, then Lin.
  expect(rings()[1].className).toContain(peerLook(peer("u3").colour).border);
});

it("a third person on a clip gets no ring of their own", () => {
  const { rings } = setup([grace, lin, mary]);
  expect(rings()).toHaveLength(2);
});

it("initials sit inside the ring, and a narrow ring gets none", () => {
  const doc = sampleDoc();
  doc.tracks[1].clips.push(text("x3", 200, 10)); // 20 px wide, so a 24 px ring
  const { rings, peer } = setup([{ ...grace, clipIds: ["x2", "x3"] }, lin, mary], makeStore({ doc }));
  const [wide, second, narrow] = rings();
  const chips = wide.querySelector<HTMLElement>("[data-peer-chips]")!;
  expect(wide.contains(chips)).toBe(true);
  expect(chips.className).toContain("sticky");
  expect(chips.className).toContain("ml-auto");
  const spans = [...chips.children] as HTMLElement[];
  expect(spans.map((s) => s.textContent)).toEqual(["GH", "LL", "+1"]);
  expect(spans[0].className).toContain(peerLook(peer("u2").colour).bg);
  expect(spans[1].className).toContain(peerLook(peer("u3").colour).bg);
  expect(spans[2].className).toContain(PEER_MORE);
  expect(spans[0].className).toContain("size-3.5");
  expect(second.querySelector("[data-peer-chips]")).toBeNull(); // only the first ring carries them
  expect(box(narrow).width).toBe(24);
  expect(narrow.querySelector("[data-peer-chips]")).toBeNull();
});

it("the track band is z-[25] with its sticky left bar, and it does not cover the ruler", () => {
  const { bands, rows, peer } = setup([{ ...grace, clipIds: [], trackId: "t1" }]);
  expect(bands()).toHaveLength(1);
  const band = bands()[0];
  const look = peerLook(peer("u2").colour);
  expect(band.dataset.peerTrack).toBe("t1");
  expect(band.className).toContain("z-[25]");
  expect(band.className).toContain("inset-x-0");
  expect(band.className).toContain("pointer-events-none");
  expect(band.className).toContain("border-y");
  expect(band.className).toContain(look.border);
  expect(band.className).not.toContain("dashed");
  expect(box(band).top).toBe(T1 * ROW_HEIGHT);
  expect(box(band).height).toBe(ROW_HEIGHT);
  const bar = band.querySelector<HTMLElement>("[data-peer-track-bar]")!;
  expect(bar.className).toContain("sticky");
  expect(bar.className).toContain("left-0");
  expect(bar.className).toContain(look.bg);
  // It lives in the rows, under the sticky ruler (z-30), never in it.
  const ruler = screen.getByRole("slider", { name: "Playhead" }).closest<HTMLElement>(".sticky.top-0")!;
  expect(ruler.className).toContain("z-30");
  expect(ruler.contains(band)).toBe(false);
  expect(rows.contains(band)).toBe(true);
});

it("an unknown track gets no band", () => {
  const { bands } = setup([{ ...grace, clipIds: [], trackId: "gone" }]);
  expect(bands()).toHaveLength(0);
});

it("clips out of the window, unknown or deleted get no ring", () => {
  const doc = sampleDoc();
  doc.tracks[1].clips.push(text("far", 5000, 30)); // far right of the rendered window
  const store = makeStore({ doc });
  const { rings, st } = setup([{ ...grace, clipIds: ["far", "nope", "x1"] }], store);
  expect(rings()).toHaveLength(1);
  expect(box(rings()[0]).left).toBe(x(0) - 2);
  act(() => st().select(["x1"]));
  act(() => deleteSelection(store, false));
  expect(rings()).toHaveLength(0);
});

it("rings follow a local drag", () => {
  const { rings, clip, press, move, release, frame } = setup([grace]);
  press(clip("x2"), x(94), y(T1));
  move(x(114), y(T1));
  frame();
  expect(box(rings()[0]).left).toBe(x(110) - 2); // the preview, before anything is saved
  release(x(114), y(T1));
  expect(box(rings()[0]).left).toBe(x(110) - 2);
});

it("a press through a ring still selects the clip under it", () => {
  const { rings, clip, press, release, st } = setup([grace]);
  const ring = rings()[0];
  expect(ring.className).toContain("pointer-events-none");
  expect(ring.contains(clip("x2"))).toBe(false);
  press(clip("x2"), x(94), y(T1));
  release(x(94), y(T1));
  expect(st().selection.clipIds).toEqual(["x2"]);
});

it("a check with the same peers does not re-render the rows", () => {
  const { rings, receive } = setup([grace]);
  const renders = () =>
    vi.mocked(cx).mock.calls.filter((parts) => parts.some((p) => typeof p === "string" && (p.startsWith("bg-ed-clip-") || p.startsWith("sticky left-0 z-20")))).length;
  vi.mocked(cx).mockClear();
  receive([{ ...grace }]);
  expect(renders()).toBe(0);
  expect(vi.mocked(cx).mock.calls).toHaveLength(0); // the marks did not re-render either
  receive([{ ...grace, clipIds: ["x1"] }]);
  expect(renders()).toBe(0); // only the marks re-render when the list changes
  expect(box(rings()[0]).left).toBe(x(0) - 2);
});

it("nothing is drawn when nobody else is here", () => {
  const { rings, bands, receive } = setup([grace]);
  receive([]);
  expect(rings()).toHaveLength(0);
  expect(bands()).toHaveLength(0);
});
