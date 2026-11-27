"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { cx } from "@/components/ui/cx";
import type { Point } from "@/lib/editor/board";
import {
  HANDLE_SIGNS,
  clampInto,
  corners,
  cursorFor,
  fromScreen,
  handlePoints,
  hitTest,
  outsetCorners,
  rotateSpots,
  toOverlay,
  toWorld,
  type Box,
  type CanvasItem,
  type Handle,
  type PreviewSurface,
  type View,
} from "@/lib/editor/canvas-geometry";
import { addText, editTextInPlace } from "@/lib/editor/actions";
import { guideAt } from "@/lib/editor/guides";
import { TEXT_PRESETS } from "@/lib/editor/text-presets";
import { previewMenu, rightClickEntries } from "@/lib/editor/menus";
import { clipMarks, type Peer } from "@/lib/editor/presence";
import { findClip, viewDoc, type EditorState } from "@/lib/editor/store";
import { drawsShape } from "@/lib/editor/tools";
import type { ShapeClip, TimelineDoc } from "@/lib/timeline";
import { useBrand } from "./brand/brand-context";
import { CanvasTextEditor } from "./canvas-text-editor";
import { useClipboard, useEditor, useEditorStore, useSettingsStore } from "./context";
import { useToMenuItems } from "./menu-items";
import { CLICK_SLOP_PX } from "./timeline/use-clip-drag";
import { PEER_MORE, peerLook } from "./peer-look";
import { usePresenceStore } from "./presence-context";
import { useCanvasDrag } from "./use-canvas-drag";
import { useCaptionDrag } from "./use-caption-drag";
import { useGuideDrag } from "./use-guide-drag";
import { useShapeDraw } from "./use-shape-draw";
import { useArrowDrag } from "./use-arrow-drag";
import { hasRoomForPoint, readGrip, removePointOps, straightenOps, type ArrowGrip, type ArrowGripKind } from "@/lib/editor/arrow-drag";
import { segmentPoint } from "@/lib/timeline/arrow-path";
import { arrowPath } from "@/lib/timeline/shapes";
import { useClipMenu } from "./use-clip-menu";
import { useCommandRunner, useIsMac } from "./use-shortcuts";

// How far outside a clip's box, in CSS pixels, a press still takes it.
const HIT_SLOP_PX = 4;

// The handles, in CSS pixels: each is an 8 px square in a 24 px target, or just the square on a box under 48 px a
// side. A handle off the visible pane is drawn 12 px inside its edge, and one that would land within 12 px of a handle
// placed before it, when either was clamped, is left out. A box thinner than 24 px has its side handles 12 px outside.
// The rotate handle is 24 px above the top edge (36 when n and s are pushed out). With no room above, it is as far
// below the bottom edge, or else 24 px past the right side and then the left (36 when e and w are pushed out). With
// no room on any side, it is 36 px inside from n.
const SQUARE_PX = 8;
const TARGET_PX = 24;
// The small handle that adds a point to a line: a 16 px target, so it never covers the handles of the points beside it.
const ADD_TARGET_PX = 16;
const SMALL_BOX_PX = 48;
const EDGE_PX = 12;
const ROTATE_PX = 24;
const ROTATE_FAR_PX = 36;
// By touch (a coarse pointer, or the last press was a finger) every handle is a 40 px target round the same 8 px
// square, and a press lands on a clip up to 12 px outside its box. A box under 80 px a side has no room for those
// targets and a place to move it from, so it shows its four corners only, each drawn just outside its corner: a touch
// anywhere in the box moves it. The rotate handle sits 40 px past the top edge.
const TOUCH_TARGET_PX = 40;
const TOUCH_SLOP_PX = 12;
const TOUCH_ROOM_PX = 80;
const TOUCH_ROTATE_PX = 40;
const CORNERS: Handle[] = ["nw", "ne", "se", "sw"];
const COARSE = "(pointer: coarse)";
const coarseQuery = () => (typeof window === "undefined" || typeof window.matchMedia !== "function" ? null : window.matchMedia(COARSE));

// The order handles are placed in; a later one clamped onto an earlier one's spot is the one left out.
const PLACING: Handle[] = ["nw", "ne", "se", "sw", "n", "e", "s", "w"];

// Teammates' outlines sit 3 CSS px outside a clip, then 6 px for the second; a clip outlines at most two of them.
const PEER_RING_PX = 3;
const PEERS_OUTLINED = 2;
// A name pill is 16 px tall, 2 px clear of its outline and of the pane's edge, at most 160 px wide (max-w-40), and
// one that would overlap a pill placed before it moves to 18 px below that one.
const PILL_PX = 16;
const PILL_GAP_PX = 2;
const PILL_MAX_PX = 160;
const PILL_STEP_PX = 18;

// No preview menu offers "Keyboard shortcuts", so its commands never open them.
const noShortcuts = () => {};

type Outline = { clipId: string; points: string };
// A handle where it is drawn, in overlay pixels; clamped when it was moved into the visible pane. look: a resize
// handle's square or a crop mark (never for rotate); turn: the clip's rotation, which a crop mark follows.
type HandleView = {
  grip: Handle | "rotate";
  clipId: string;
  left: number;
  top: number;
  size: number;
  cursor: string;
  clamped: boolean;
  look?: "resize" | "crop";
  turn: number;
};
type Guide = { axis: "x" | "y"; x1: number; y1: number; x2: number; y2: number };
// A teammate's outline round one clip, in their colour slot.
type PeerOutline = { key: string; clipId: string; colour: number; points: string };
// A name pill, placed by its left edge or, near the pane's right, by its right (CSS right, from the overlay's right
// edge). userId null is the "+N" pill of a clip with more people on it than are outlined; it has no colour.
type PeerLabel = { key: string; userId: string | null; text: string; colour: number | null; top: number; left?: number; right?: number };
type PeerMarks = { peerOutlines: PeerOutline[]; peerLabels: PeerLabel[] };
const NO_PEER_MARKS: PeerMarks = { peerOutlines: [], peerLabels: [] };
// full: the whole box of a clip being cropped, uncut, while a crop drag runs.
// placed: the project's guides, each across the frame, with the one picked marked and its position as a label. One
// dragged past the frame's edge is marked removing, and its label says so.
type Placed = Guide & { id: string; selected: boolean; removing: boolean; label: string };
// slots: the empty template slots drawn now, each a dashed box (its polygon) and its name at the box's top-left corner.
type SlotMark = { clipId: string; name: string; points: string; left: number; top: number };
// ends: a selected arrow's handles, in overlay pixels: its tail and tip, one on each point its line passes through,
// and a smaller one between each two of those, which adds a point there when dragged.
type EndHandle = { grip: ArrowGrip; kind: ArrowGripKind; clipId: string; left: number; top: number };
type Drawn = { outlines: Outline[]; handles: HandleView[]; ends: EndHandle[]; guides: Guide[]; placed: Placed[]; full: string | null; slots: SlotMark[] } & PeerMarks;
const NOTHING_DRAWN: Drawn = { outlines: [], handles: [], ends: [], guides: [], placed: [], full: null, slots: [], ...NO_PEER_MARKS };

// A clamped handle being dragged is drawn at the pointer (client pixels, null until it moves), clamped the same way.
type Follow = { pointerId: number; grip: Handle; client: Point | null };

// The Text tool's body text, in the space's brand kit fonts.
const TEXT_TOOL_PRESET = TEXT_PRESETS.find((p) => p.id === "body") ?? TEXT_PRESETS[0];

// A press waiting for its release: on a selected clip the release leaves only that clip ("only"); with Shift, Cmd
// or (away from a Mac) Ctrl it toggles the clip. A pointer that passes the click slop does neither.
type Press = { pointerId: number; clipId: string; x: number; y: number; then: "toggle" | "only" | null };

// Overlay pixels are kept to two decimals, so the same place always reads the same.
const px = (v: number) => Math.round(v * 100) / 100;

// The layer over the preview board, frame and margin alike, where clips are pressed, right-clicked, outlined, moved,
// turned, resized and cropped. What it draws is worked out outside render, whenever the preview draws or its board
// moves and whenever the selection, a drag's guides or what shows crop marks change, and only a change is set. A press selects the top-most clip under
// the pointer, clicking through locked tracks; outside the frame only a selected clip takes it; a press that travels
// moves the clip. One selected clip that can be edited, paused, has eight handles and a rotate handle, which keeps off
// the clip's picture while the pane has room past one of its sides. A right-click opens the clip's menu (a handle's is
// its clip's), or the preview's when it lands on nothing or on a clip of a locked track. On a Mac a Ctrl press is that
// right-click, except on a resize handle, where Ctrl crops and the browser's right-click is kept from opening a menu.
// A double-click on text opens its box for typing in place (or says its track is locked); while the box is open its
// clip has no outline or handles, and what lands in the box is the box's.
// The handles but rotate show as crop marks while Ctrl is down with the pointer over the board, while a drag crops,
// while the Crop tool is on, and while the clip menu's Crop has armed the clip; while handles show, a lone Alt (which resizes about the middle) never
// reaches the browser, so it does not open a Windows browser's menu.
// Teammates' selections are outlined in their colours, outside the clip and under your own outline, with a name pill
// each; only clips drawn now get them, and none while playing. They never change what a press takes.
export function CanvasOverlay({ surface, pane }: { surface: PreviewSurface; pane: RefObject<HTMLElement | null> }): ReactNode {
  const store = useEditorStore();
  const presence = usePresenceStore();
  const clipboard = useClipboard();
  const menu = useContextMenu();
  const toItems = useToMenuItems();
  const run = useCommandRunner(noShortcuts);
  const openClipMenu = useClipMenu();
  const isMac = useIsMac();
  const ref = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const follow = useRef<Follow | null>(null);
  const ctrlDown = useRef(false);
  // A Mac Ctrl press on a resize handle, whose right-click must open nothing, wherever the browser aims it.
  const ctrlCrop = useRef(false);
  const pointerOver = useRef(false);
  // Whether the handles are laid out for a finger: on a coarse pointer, and after a touch press on any screen, until
  // a mouse or pen press says otherwise.
  const touch = useRef(coarseQuery()?.matches ?? false);
  const refreshRef = useRef<() => void>(() => {});
  const drag = useCanvasDrag(surface, pane);
  const guideDrag = useGuideDrag(surface);
  const captionDrag = useCaptionDrag(surface);
  const [drawn] = useState(() => createStore<Drawn>(() => NOTHING_DRAWN));
  const outlines = useStore(drawn, (s) => s.outlines);
  const handles = useStore(drawn, (s) => s.handles);
  const ends = useStore(drawn, (s) => s.ends);
  const guides = useStore(drawn, (s) => s.guides);
  const placed = useStore(drawn, (s) => s.placed);
  const full = useStore(drawn, (s) => s.full);
  const slots = useStore(drawn, (s) => s.slots);
  const peerOutlines = useStore(drawn, (s) => s.peerOutlines);
  const peerLabels = useStore(drawn, (s) => s.peerLabels);
  const handlesShown = handles.length > 0;
  const arrowDrag = useArrowDrag(surface);
  const textEditId = useEditor((s) => s.textEditId);
  const settings = useSettingsStore();
  const { fonts, colors } = useBrand().kit;
  // A new shape takes the brand kit's first colour; the drag reads it when it starts.
  const brandColor = useRef<string | undefined>(undefined);
  useEffect(() => {
    brandColor.current = colors[0];
  }, [colors]);
  const shapeDraw = useShapeDraw(surface, { seconds: () => settings.getState().textSeconds, color: () => brandColor.current });
  // The tool shows in the cursor: text for Text, a crosshair for Guide. Someone who can't edit keeps Selection.
  const tool = useEditor((s) => (s.canEdit ? s.tool : "select"));
  // A Text tool press waiting for its release, which adds or opens text there if the pointer stayed put.
  const textPress = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const refresh = () => {
      const el = ref.current;
      const view = surface.view();
      const state = store.getState();
      let next: Drawn = NOTHING_DRAWN;
      if (el && view) {
        const box = el.getBoundingClientRect();
        const items = surface.items();
        const f = follow.current;
        const followed = f?.client ? { grip: f.grip, at: { x: f.client.x - box.left, y: f.client.y - box.top } } : null;
        const cropping = drag.cropping.getState().clipId;
        const marks = (clipId: string) =>
          (ctrlDown.current && pointerOver.current) || cropping === clipId || state.cropArmed === clipId || (state.canEdit && state.tool === "crop");
        const cut = items.find((i) => i.clipId === cropping);
        // The text being typed in place shows its own box instead.
        const framed = items.filter((i) => i.clipId !== state.textEditId);
        const visible = surface.visible();
        const ends = endsOf(state, framed, view, box, visible);
        next = {
          // An arrow showing its end handles needs no box round it.
          outlines: outlinesOf(framed.filter((i) => !ends.some((e) => e.clipId === i.clipId)), state.selection.clipIds, view, box),
          handles: handlesOf(state, framed, view, box, visible, followed, marks, touch.current),
          ends,
          guides: guidesOf(drag.guides.getState(), viewDoc(state), view, box),
          placed: state.showGuides ? placedOf(viewDoc(state), state.guideId, guideDrag.removing.getState().guideId, view, box) : [],
          full: cut ? fullOf(cut, view, box) : null,
          slots: slotsOf(items, view, box),
          ...(state.playing ? NO_PEER_MARKS : peerMarksOf(framed, presence.getState().peers, view, box, visible)),
        };
      }
      const now = drawn.getState();
      const patch: Partial<Drawn> = {};
      if (!sameOutlines(now.outlines, next.outlines)) patch.outlines = next.outlines;
      if (JSON.stringify(now.handles) !== JSON.stringify(next.handles)) patch.handles = next.handles;
      if (JSON.stringify(now.ends) !== JSON.stringify(next.ends)) patch.ends = next.ends;
      if (JSON.stringify(now.guides) !== JSON.stringify(next.guides)) patch.guides = next.guides;
      if (JSON.stringify(now.placed) !== JSON.stringify(next.placed)) patch.placed = next.placed;
      if (now.full !== next.full) patch.full = next.full;
      if (JSON.stringify(now.slots) !== JSON.stringify(next.slots)) patch.slots = next.slots;
      // Playback refreshes every frame; an unchanged list must not render again.
      if (JSON.stringify(now.peerOutlines) !== JSON.stringify(next.peerOutlines)) patch.peerOutlines = next.peerOutlines;
      if (JSON.stringify(now.peerLabels) !== JSON.stringify(next.peerLabels)) patch.peerLabels = next.peerLabels;
      if (Object.keys(patch).length > 0) drawn.setState(patch);
    };
    refreshRef.current = refresh;
    const stopSurface = surface.onChange(refresh);
    const stopStore = store.subscribe((s, prev) => {
      if (
        s.selection !== prev.selection ||
        s.canEdit !== prev.canEdit ||
        s.playing !== prev.playing ||
        s.cropArmed !== prev.cropArmed ||
        s.textEditId !== prev.textEditId ||
        s.guideId !== prev.guideId ||
        s.tool !== prev.tool ||
        s.showGuides !== prev.showGuides ||
        viewDoc(s).guides !== viewDoc(prev).guides
      ) {
        refresh();
      }
    });
    const stopGuides = drag.guides.subscribe(refresh);
    const stopRemoving = guideDrag.removing.subscribe(refresh);
    const stopCropping = drag.cropping.subscribe(refresh);
    const stopPresence = presence.subscribe((s, prev) => {
      if (s.peers !== prev.peers) refresh();
    });
    return () => {
      stopSurface();
      stopStore();
      stopGuides();
      stopRemoving();
      stopCropping();
      stopPresence();
      refreshRef.current = () => {};
    };
  }, [surface, store, drawn, drag, guideDrag, presence]);

  // While handles show, Ctrl is followed from the keys, and a lone Alt press or release is kept from the browser, which
  // would otherwise focus its menu (Firefox opens it on the release). Alt with another key is left alone.
  useEffect(() => {
    if (!handlesShown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt") e.preventDefault();
      setCtrl(e.ctrlKey);
    };
    // A window left with a key held (Alt+Tab, Ctrl+Tab) never hears the release.
    const onBlur = () => setCtrl(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur);
      ctrlDown.current = false;
    };
  }, [handlesShown]);

  // A pointer that turns coarse or fine (a tablet's keyboard folded away, a mouse plugged in) lays the handles out again.
  useEffect(() => {
    const query = coarseQuery();
    if (!query?.addEventListener) return;
    const onChange = () => {
      touch.current = query.matches;
      refreshRef.current();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  function setCtrl(down: boolean) {
    if (ctrlDown.current === down) return;
    ctrlDown.current = down;
    refreshRef.current();
  }

  function setOver(over: boolean) {
    if (pointerOver.current === over) return;
    pointerOver.current = over;
    refreshRef.current();
  }

  // A dragged handle stops following the pointer when the pointer comes up or is lost.
  function stopFollowing(pointerId: number) {
    if (follow.current?.pointerId !== pointerId) return;
    follow.current = null;
    refreshRef.current();
  }

  // A press on a handle starts its drag at once, whatever the modifiers. One drawn clamped into the pane tells the
  // drag where it was drawn, and is then drawn at the pointer.
  function onHandleDown(e: PointerEvent<HTMLDivElement>, grip: Handle | "rotate") {
    const shown = drawn.getState().handles.find((h) => h.grip === grip);
    const view = surface.view();
    if (!shown || !view) return;
    const box = e.currentTarget.getBoundingClientRect();
    const clamped = shown.clamped && grip !== "rotate";
    const at = clamped ? fromScreen(view, box.left + shown.left, box.top + shown.top) : undefined;
    follow.current = clamped ? { pointerId: e.pointerId, grip, client: null } : null;
    drag.press(e, grip, shown.clipId, at);
  }

  // The clip under a client point, with the slop and frame rule every press and right-click uses; a finger's press
  // passes the wider touch slop.
  function hitAt(state: EditorState, view: View, clientX: number, clientY: number, includeLocked: boolean, slopPx = HIT_SLOP_PX): CanvasItem | null {
    const doc = viewDoc(state);
    return hitTest(surface.items(), fromScreen(view, clientX, clientY), slopPx / view.k, {
      includeLocked,
      frame: { width: doc.width, height: doc.height },
      keep: state.selection.clipIds,
    });
  }

  // A finger's press lays the handles out for touch, a mouse's or pen's for a pointer; one of no known kind changes
  // nothing. The press itself is taken as the handles were drawn when it landed, and the new layout drawn after it.
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const was = touch.current;
    touch.current = e.pointerType === "touch" ? true : e.pointerType === "mouse" || e.pointerType === "pen" ? false : was;
    pressDown(e);
    if (touch.current !== was) refreshRef.current();
  }

  function pressDown(e: PointerEvent<HTMLDivElement>) {
    // A Text press whose release went elsewhere is forgotten, so it never adds text later.
    textPress.current = null;
    if (inTextEditor(e.target)) return;
    const end = endOf(e.target);
    if (end && e.button === 0) {
      arrowDrag.press(e, end.clipId, end.grip);
      return;
    }
    const grip = gripOf(e.target);
    if (isMac && e.ctrlKey && !resizes(grip)) return; // a right-click
    ctrlCrop.current = isMac && e.ctrlKey;
    press.current = null;
    if (e.button !== 0) return;
    if (grip) return onHandleDown(e, grip);
    const view = surface.view();
    if (!view) return;
    const state = store.getState();
    // The Shape and Line tools draw wherever they are pressed, over clips and guides alike.
    if (state.canEdit && drawsShape(state.tool)) {
      shapeDraw.press(e);
      return;
    }
    if (state.canEdit && state.tool === "text") {
      textPress.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    // A press on a shown guide picks it and can move it, with the Guide tool too, ahead of any clip under it: a guide
    // over a video that fills the frame could never be picked otherwise. The Guide tool places a new guide anywhere else.
    const doc = viewDoc(state);
    const onGuide =
      state.canEdit && state.showGuides ? guideAt(doc.guides ?? [], fromScreen(view, e.clientX, e.clientY), doc, HIT_SLOP_PX / view.k) : null;
    if (onGuide) {
      state.selectGuide(onGuide.id);
      guideDrag.press(e, onGuide);
      return;
    }
    if (state.canEdit && state.tool === "guide") {
      guideDrag.press(e, null);
      return;
    }
    const hit = hitAt(state, view, e.clientX, e.clientY, false, touch.current ? TOUCH_SLOP_PX : HIT_SLOP_PX);
    if (!hit) {
      state.select([]);
      return;
    }
    // Captions: a press selects their caption clip alone, and a drag moves every caption up or down.
    if (hit.type === "caption") {
      state.select([hit.clipId]);
      if (state.canEdit && !hit.locked) captionDrag.press(e);
      return;
    }
    const toggle = e.shiftKey || e.metaKey || (!isMac && e.ctrlKey);
    const selected = state.selection.clipIds.includes(hit.clipId);
    if (!toggle && !selected) state.select([hit.clipId]);
    press.current = { pointerId: e.pointerId, clipId: hit.clipId, x: e.clientX, y: e.clientY, then: toggle ? "toggle" : selected ? "only" : null };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; its release still arrives here or not at all.
    }
    // Once it travels the press moves the clip, which the drag makes the only selection.
    drag.press(e, "body", hit.clipId);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    setOver(true);
    setCtrl(e.ctrlKey);
    const f = follow.current;
    if (f && f.pointerId === e.pointerId) {
      f.client = { x: e.clientX, y: e.clientY };
      refreshRef.current();
    }
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= CLICK_SLOP_PX) p.then = null;
  }

  // The Text tool's click: on a text clip it opens that text; anywhere else it adds body text centred there, at the
  // playhead, and opens it. Either way the tool goes back to Selection.
  function textToolClick(clientX: number, clientY: number) {
    const view = surface.view();
    const state = store.getState();
    if (!view || !state.canEdit) return;
    const hit = hitAt(state, view, clientX, clientY, false);
    const found = hit ? viewDoc(state).tracks.flatMap((t) => t.clips).find((c) => c.id === hit.clipId) : undefined;
    if (hit && found?.type === "text") {
      editTextInPlace(store, hit.clipId);
    } else {
      const doc = viewDoc(state);
      const point = fromScreen(view, clientX, clientY);
      const at = { x: point.x / doc.width, y: point.y / doc.height };
      const id = addText(store, TEXT_TOOL_PRESET, settings.getState().textSeconds, fonts, at);
      if (id) editTextInPlace(store, id, { selectAll: true });
    }
    store.getState().setTool("select");
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    ctrlCrop.current = false;
    stopFollowing(e.pointerId);
    const typed = textPress.current;
    textPress.current = null;
    const stillText = store.getState().tool === "text";
    if (typed && stillText && typed.pointerId === e.pointerId && Math.hypot(e.clientX - typed.x, e.clientY - typed.y) < CLICK_SLOP_PX) {
      textToolClick(e.clientX, e.clientY);
      return;
    }
    const p = press.current;
    press.current = null;
    if (!p || p.pointerId !== e.pointerId || p.then === null) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= CLICK_SLOP_PX) return;
    store.getState().select([p.clipId], p.then === "toggle" ? "toggle" : "replace");
  }

  // A double-click on text, locked or not, opens it for typing; a video or image starts nothing. The press before it
  // has already selected what a press takes. With the Guide tool its presses place guides, so it opens nothing.
  // A double-click on one of a line's points takes that point off the line.
  function onDoubleClick(e: MouseEvent<HTMLDivElement>) {
    if (inTextEditor(e.target)) return;
    const state = store.getState();
    // A press on a handle keeps the pointer for a drag, so the double-click is told to this layer and not to the
    // handle: the handle is found by where the pointer is.
    const end = endOf(e.target) ?? endOf(document.elementFromPoint?.(e.clientX, e.clientY) ?? null);
    if (end) {
      const point = readGrip(end.grip);
      if (point.kind === "point") removePoint(end.clipId, point.index);
      return;
    }
    if (state.canEdit && (state.tool === "guide" || drawsShape(state.tool))) return;
    const view = surface.view();
    if (!view) return;
    const hit = hitAt(state, view, e.clientX, e.clientY, true);
    if (hit) editTextInPlace(store, hit.clipId);
  }

  // The arrow whose handle was pressed, while it can still be changed.
  function arrowOf(clipId: string): ShapeClip | null {
    const state = store.getState();
    const found = findClip(state.doc, clipId);
    if (!state.canEdit || !found || found.track.locked || found.clip.type !== "shape" || found.clip.shape !== "arrow") return null;
    return found.clip;
  }

  function removePoint(clipId: string, index: number) {
    const clip = arrowOf(clipId);
    const ops = clip ? removePointOps(clip, index) : [];
    if (ops.length > 0) store.getState().edit(ops, "bend arrow");
  }

  function onContextMenu(e: MouseEvent<HTMLDivElement>) {
    // The box's own menu is the browser's, as in any text field.
    if (inTextEditor(e.target)) return;
    e.preventDefault();
    // One of a line's points has a menu of its own.
    const end = endOf(e.target);
    const point = end ? readGrip(end.grip) : null;
    if (end && point?.kind === "point" && menu) {
      menu({
        ...menuPoint(e),
        label: "Point",
        items: [
          { id: "remove", label: "Remove point" },
          { id: "straighten", label: "Straighten line" },
        ],
        onSelect: (id) => {
          if (id === "remove") return removePoint(end.clipId, point.index);
          const clip = arrowOf(end.clipId);
          const ops = clip ? straightenOps(clip) : [];
          if (ops.length > 0) store.getState().edit(ops, "bend arrow");
        },
      });
      return;
    }
    const grip = gripOf(e.target);
    // On a Mac, Ctrl on a resize handle crops: the right-click its press makes opens nothing.
    if (ctrlCrop.current) {
      ctrlCrop.current = false;
      return;
    }
    if (!menu) return;
    const shown = grip ? drawn.getState().handles.find((h) => h.grip === grip) : undefined;
    if (shown) {
      openClipMenu(e, shown.clipId);
      return;
    }
    const view = surface.view();
    const state = store.getState();
    const hit = view ? hitAt(state, view, e.clientX, e.clientY, true) : null;
    if (hit && !hit.locked) {
      openClipMenu(e, hit.clipId);
      return;
    }
    const entries = rightClickEntries(previewMenu(state, clipboard.read() !== null), state.canEdit);
    if (entries.length === 0) return;
    menu({
      ...menuPoint(e),
      label: "Preview",
      items: toItems(entries),
      onSelect: (id) => {
        if (id === "paste") run("paste");
        else if (id === "safe-zones") store.getState().toggleSafeZones();
      },
    });
  }

  return (
    <div
      ref={ref}
      data-canvas-overlay
      className={cx("absolute inset-0 touch-none select-none", tool === "text" && "cursor-text", (tool === "guide" || drawsShape(tool)) && "cursor-crosshair")}
      onPointerDown={onPointerDown}
      onPointerEnter={() => setOver(true)}
      onPointerLeave={() => setOver(false)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        press.current = null;
        textPress.current = null;
        ctrlCrop.current = false;
        stopFollowing(e.pointerId);
      }}
      onLostPointerCapture={(e) => {
        press.current = null;
        ctrlCrop.current = false;
        stopFollowing(e.pointerId);
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
        {peerOutlines.map((o) => (
          <g key={o.key}>
            <polygon
              data-peer-outline={o.clipId}
              data-peer-halo
              points={o.points}
              fill="none"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
              className="stroke-ed-bg opacity-50"
            />
            <polygon
              data-peer-outline={o.clipId}
              points={o.points}
              fill="none"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
              className={peerLook(o.colour).stroke}
            />
          </g>
        ))}
        {full && (
          <polygon
            data-crop-full
            points={full}
            fill="none"
            strokeWidth={1}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            className="stroke-ed-accent"
          />
        )}
        {slots.map((s) => (
          <polygon
            key={s.clipId}
            data-slot-box={s.clipId}
            points={s.points}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            className="stroke-ed-muted"
          />
        ))}
        {outlines.map((o) => (
          <polygon
            key={o.clipId}
            points={o.points}
            fill="none"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            className="stroke-ed-accent"
          />
        ))}
        {placed.map((g) => (
          <line
            key={g.id}
            data-project-guide={g.id}
            data-selected={g.selected || undefined}
            data-removing={g.removing || undefined}
            x1={g.x1}
            y1={g.y1}
            x2={g.x2}
            y2={g.y2}
            strokeWidth={g.selected ? 2 : 1}
            strokeDasharray={g.removing ? "4 3" : undefined}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            className={g.removing ? "stroke-ed-danger" : "stroke-ed-guide"}
          />
        ))}
        {guides.map((g) => (
          <line
            key={g.axis}
            data-canvas-guide={g.axis}
            x1={g.x1}
            y1={g.y1}
            x2={g.x2}
            y2={g.y2}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            className="stroke-ed-accent"
          />
        ))}
      </svg>
      {slots.map((s) => (
        <span
          key={s.clipId}
          aria-hidden
          data-slot-label={s.clipId}
          style={{ left: s.left + 4, top: s.top + 4 }}
          className="pointer-events-none absolute max-w-40 truncate rounded-[3px] bg-ed-bg px-1 text-[11px] leading-4 font-medium text-ed-muted"
        >
          {s.name}
        </span>
      ))}
      {placed
        .filter((g) => g.selected)
        .map((g) => (
          // The picked guide's position, just inside the frame where the line starts.
          <span
            key={g.id}
            aria-hidden
            data-guide-label
            style={{ left: g.x1 + 4, top: g.y1 + 4 }}
            className={cx(
              "pointer-events-none absolute rounded-[3px] px-1 text-[11px] leading-4 font-medium text-ed-bg tabular-nums",
              g.removing ? "bg-ed-danger" : "bg-ed-guide",
            )}
          >
            {g.label}
          </span>
        ))}
      {peerLabels.map((l) => (
        <div
          key={l.key}
          aria-hidden
          data-peer-label={l.userId ?? "more"}
          className={cx(
            "pointer-events-none absolute max-w-40 truncate rounded-[3px] px-1 text-[11px] leading-4 font-medium",
            l.colour === null ? PEER_MORE : cx(peerLook(l.colour).bg, "text-ed-bg"),
          )}
          style={{ top: l.top, left: l.left, right: l.right }}
        >
          {l.text}
        </div>
      ))}
      {handles.map((h) => (
        <div
          key={h.grip}
          data-canvas-handle={h.grip}
          data-look={h.look}
          className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          style={{ left: h.left, top: h.top, width: h.size, height: h.size, cursor: h.cursor }}
        >
          {h.look === "crop" && h.grip !== "rotate" ? (
            <CropMark grip={h.grip} turn={h.turn} />
          ) : (
            <span className={cx("size-2 border border-ed-accent bg-ed-bg", h.grip === "rotate" && "rounded-full")} />
          )}
        </div>
      ))}
      {ends.map((h) => (
        <div
          key={h.grip}
          data-shape-end={h.grip}
          data-clip-id={h.clipId}
          className="group absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          data-kind={h.kind}
          title={h.kind === "point" ? "Drag to reshape the line. Double-click to remove this point." : h.kind === "add" ? "Drag to add a point the line passes through." : undefined}
          style={{ left: h.left, top: h.top, width: h.kind === "add" ? ADD_TARGET_PX : TARGET_PX, height: h.kind === "add" ? ADD_TARGET_PX : TARGET_PX, cursor: h.kind === "end" ? "crosshair" : "move" }}
        >
          <span
            className={cx(
              "rounded-full border border-ed-accent",
              // An end is a ring, a point a filled dot, and the handle that adds a point a smaller ring that fills under the pointer.
              h.kind === "end" ? "size-2.5 bg-ed-bg" : h.kind === "point" ? "size-2.5 bg-ed-accent" : "size-2 bg-ed-bg group-hover:bg-ed-accent",
            )}
          />
        </div>
      ))}
      {textEditId !== null && <CanvasTextEditor key={textEditId} clipId={textEditId} surface={surface} />}
    </div>
  );
}

// A crop mark in a handle's 24 px target, turned with the clip: a side's is a 14 × 4 bar along its side, a corner's an L
// of two 12 × 4 bars on its two sides, in the accent colour with a 1 px edge of the background.
function CropMark({ grip, turn }: { grip: Handle; turn: number }): ReactNode {
  return (
    <svg
      aria-hidden
      width={TARGET_PX}
      height={TARGET_PX}
      viewBox={`0 0 ${TARGET_PX} ${TARGET_PX}`}
      className="pointer-events-none absolute top-1/2 left-1/2 overflow-visible"
      style={{ transform: `translate(-50%, -50%) rotate(${turn}deg)` }}
    >
      <polygon points={markPoints(grip)} strokeWidth={2} paintOrder="stroke" className="fill-ed-accent stroke-ed-bg" />
    </svg>
  );
}

// A crop mark's outline in its 24 px target, whose middle is the handle's spot; the bars straddle the box's edges.
function markPoints(grip: Handle): string {
  const { hx, hy } = HANDLE_SIGNS[grip];
  const c = TARGET_PX / 2;
  let points: [number, number][];
  if (hx === 0) points = [[c - 7, c - 2], [c + 7, c - 2], [c + 7, c + 2], [c - 7, c + 2]];
  else if (hy === 0) points = [[c - 2, c - 7], [c + 2, c - 7], [c + 2, c + 7], [c - 2, c + 7]];
  else {
    // The L's outer corner, then along the top or bottom edge, back along the inside, and out along the side edge.
    const ox = c + 2 * hx;
    const oy = c + 2 * hy;
    points = [[ox, oy], [ox - 12 * hx, oy], [ox - 12 * hx, oy - 4 * hy], [ox - 4 * hx, oy - 4 * hy], [ox - 4 * hx, oy - 12 * hy], [ox, oy - 12 * hy]];
  }
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

// Whether an event landed in the box text is typed in.
function inTextEditor(target: EventTarget): boolean {
  return target instanceof Element && target.closest("[data-canvas-text-editor]") !== null;
}

// The handle a press or right-click landed on, if any.
// A resize handle: any of the eight, not the turn handle.
const resizes = (grip: Handle | "rotate" | null): grip is Handle => grip !== null && grip !== "rotate";

function gripOf(target: EventTarget): Handle | "rotate" | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>("[data-canvas-handle]");
  return (el?.dataset.canvasHandle as Handle | "rotate" | undefined) ?? null;
}

const inside = (p: Point, box: Box) => p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;

// The arrow end handle a press landed on, if any.
function endOf(target: EventTarget | null): { grip: ArrowGrip; clipId: string } | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>("[data-shape-end]");
  if (!el?.dataset.clipId) return null;
  return { grip: el.dataset.shapeEnd as ArrowGrip, clipId: el.dataset.clipId };
}

// A selected arrow's handles, when it is the one clip selected, can be edited and nothing plays: its tail and tip, one
// on each point its line passes through, and, while it has room for another point, a small one in the middle of each
// stretch of the line. Each is kept inside the visible pane. The small ones come first, so where two meet the handle of
// a point or an end is the one on top.
function endsOf(state: EditorState, items: CanvasItem[], view: View, overlay: { left: number; top: number }, visible: Box | null): EndHandle[] {
  const ids = state.selection.clipIds;
  if (ids.length !== 1 || !state.canEdit || state.playing || !visible) return [];
  const item = items.find((i) => i.clipId === ids[0]);
  if (!item?.shape || item.shape.shape !== "arrow" || item.locked) return [];
  const clip = item.shape;
  const path = arrowPath(clip);
  const spot = (grip: ArrowGrip, own: Point): EndHandle => {
    const p = clampInto(toOverlay(view, overlay, toWorld(item, own)), visible, EDGE_PX);
    return { grip, kind: readGrip(grip).kind, clipId: item.clipId, left: px(p.x), top: px(p.y) };
  };
  const adds = hasRoomForPoint(clip) ? path.map((piece, i) => spot(`add:${i}`, segmentPoint(piece, 0.5))) : [];
  const points = path.slice(1).map((piece, i) => spot(`point:${i}`, piece.from));
  return [...adds, spot("tail", path[0].from), ...points, spot("tip", path[path.length - 1].to)];
}

// The handles of the one selected clip, when it is drawn now, can be edited, is on an unlocked track and nothing
// plays, in the overlay's pixels; the rotate handle is placed last, clear of the rest. followed: a dragged clamped
// handle drawn at the pointer. marks: whether a clip's handles show as crop marks. touch: laid out for a finger.
function handlesOf(
  state: EditorState,
  items: CanvasItem[],
  view: View,
  overlay: { left: number; top: number },
  visible: Box | null,
  followed: { grip: Handle; at: Point } | null,
  marks: (clipId: string) => boolean,
  touch = false,
): HandleView[] {
  const ids = state.selection.clipIds;
  if (ids.length !== 1 || !state.canEdit || state.playing || !visible) return [];
  const item = items.find((i) => i.clipId === ids[0]);
  if (!item || item.locked) return [];
  // An arrow has its own end handles instead; captions have none (they only move up and down).
  if (item.shape?.shape === "arrow" || item.type === "caption") return [];
  const k = view.k;
  const width = (item.rect.right - item.rect.left) * item.sx * k;
  const height = (item.rect.bottom - item.rect.top) * item.sy * k;
  // By touch, a box with too little room keeps only its corners, each moved out past its corner along the box's own
  // axes by half a target, so no target covers the box.
  const cornersOnly = touch && Math.min(width, height) < TOUCH_ROOM_PX;
  const size = touch ? TOUCH_TARGET_PX : Math.min(width, height) < SMALL_BOX_PX ? SQUARE_PX : TARGET_PX;
  const push = touch ? { ew: 0, ns: 0 } : { ew: height < TARGET_PX ? EDGE_PX / k : 0, ns: width < TARGET_PX ? EDGE_PX / k : 0 };
  const rotateOffset = touch
    ? { ns: TOUCH_ROTATE_PX / k, ew: TOUCH_ROTATE_PX / k }
    : { ns: (push.ns > 0 ? ROTATE_FAR_PX : ROTATE_PX) / k, ew: (push.ew > 0 ? ROTATE_FAR_PX : ROTATE_PX) / k };
  const at = new Map(handlePoints(item, rotateOffset.ns, push).map((p) => [p.grip, toOverlay(view, overlay, p.at)]));
  if (cornersOnly) {
    const nw = at.get("nw")!;
    const across = unit(nw, at.get("ne")!, item.rotation);
    const down = unit(nw, at.get("sw")!, item.rotation + 90);
    const out = TOUCH_TARGET_PX / 2;
    for (const grip of CORNERS) {
      const { hx, hy } = HANDLE_SIGNS[grip];
      const p = at.get(grip)!;
      at.set(grip, { x: p.x + (hx * across.x + hy * down.x) * out, y: p.y + (hx * across.y + hy * down.y) * out });
    }
  }

  const look = marks(item.clipId) && !item.shape ? "crop" : "resize"; // a shape takes no crop
  const placed: HandleView[] = [];
  const shownAs = (grip: Handle | "rotate", p: Point, clamped: boolean, cursor: string): HandleView => ({
    grip,
    clipId: item.clipId,
    left: p.x,
    top: p.y,
    size,
    cursor,
    clamped,
    ...(grip !== "rotate" && { look }),
    turn: item.rotation,
  });
  for (const grip of cornersOnly ? CORNERS : PLACING) {
    const raw = at.get(grip)!;
    const isFollowed = followed?.grip === grip;
    const p = clampInto(isFollowed ? followed.at : raw, visible, EDGE_PX);
    const clamped = isFollowed || p.x !== raw.x || p.y !== raw.y;
    const onAnother = placed.some(
      (h) => h.grip !== followed?.grip && (h.clamped || clamped) && Math.hypot(h.left - p.x, h.top - p.y) < EDGE_PX,
    );
    if (onAnother && !isFollowed) continue;
    placed.push(shownAs(grip, p, clamped, cursorFor(grip, item.rotation)));
  }

  // The rotate handle goes above the clip, or with no room there below it, then past its right side, then its left:
  // the first spot no nearer than 12 px to the visible pane's edge and not within 12 px of a handle shown. With none, it
  // goes 36 px inside from n's clamped spot, toward the box's middle.
  const room = { left: visible.left + EDGE_PX, top: visible.top + EDGE_PX, right: visible.right - EDGE_PX, bottom: visible.bottom - EDGE_PX };
  const free = (p: Point) =>
    inside(p, room) && !placed.some((h) => h.grip !== followed?.grip && Math.hypot(h.left - p.x, h.top - p.y) < EDGE_PX);
  let rotate = rotateSpots(item, rotateOffset)
    .map((p) => toOverlay(view, overlay, p))
    .find(free);
  if (!rotate) {
    const n = clampInto(at.get("n")!, visible, EDGE_PX);
    const a = (item.rotation * Math.PI) / 180;
    rotate = clampInto({ x: n.x - Math.sin(a) * ROTATE_FAR_PX, y: n.y + Math.cos(a) * ROTATE_FAR_PX }, visible, EDGE_PX);
  }
  placed.push(shownAs("rotate", rotate, false, "grab"));

  return placed.map((h) => ({ ...h, left: px(h.left), top: px(h.top) }));
}

// The way from one point to another as a unit vector; for two points in the same place (a box with no width or height
// on screen), the way the clip's turn gives.
function unit(from: Point, to: Point, degrees: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length > 0.001) return { x: dx / length, y: dy / length };
  const a = (degrees * Math.PI) / 180;
  return { x: Math.cos(a), y: Math.sin(a) };
}

// The lines a moved clip is snapped to, across the frame, in the overlay's pixels.
function guidesOf(
  snapped: { x: number | null; y: number | null },
  frame: { width: number; height: number },
  view: View,
  overlay: { left: number; top: number },
): Guide[] {
  const line = (axis: "x" | "y", from: Point, to: Point): Guide => {
    const a = toOverlay(view, overlay, from);
    const b = toOverlay(view, overlay, to);
    return { axis, x1: px(a.x), y1: px(a.y), x2: px(b.x), y2: px(b.y) };
  };
  const out: Guide[] = [];
  if (snapped.x !== null) out.push(line("x", { x: snapped.x, y: 0 }, { x: snapped.x, y: frame.height }));
  if (snapped.y !== null) out.push(line("y", { x: 0, y: snapped.y }, { x: frame.width, y: snapped.y }));
  return out;
}

// The project's guides across the frame, in the overlay's pixels.
function placedOf(doc: TimelineDoc, selectedId: string | null, removingId: string | null, view: View, overlay: { left: number; top: number }): Placed[] {
  return (doc.guides ?? []).map((g) => {
    const from = g.axis === "x" ? { x: g.at * doc.width, y: 0 } : { x: 0, y: g.at * doc.height };
    const to = g.axis === "x" ? { x: g.at * doc.width, y: doc.height } : { x: doc.width, y: g.at * doc.height };
    const a = toOverlay(view, overlay, from);
    const b = toOverlay(view, overlay, to);
    const selected = g.id === selectedId;
    const removing = g.id === removingId;
    const label = removing ? "Remove guide" : `${Number((g.at * 100).toFixed(1))}%`;
    return { id: g.id, axis: g.axis, x1: px(a.x), y1: px(a.y), x2: px(b.x), y2: px(b.y), selected, removing, label };
  });
}

// A clip's whole box, uncut, in the overlay's pixels.
function fullOf(item: CanvasItem, view: View, overlay: { left: number; top: number }): string {
  const { left, top, right, bottom } = item.full;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
    .map((p) => toOverlay(view, overlay, toWorld(item, p)))
    .map((p) => `${px(p.x)},${px(p.y)}`)
    .join(" ");
}

// The empty slots drawn now, in the overlay's pixels: the box and where its name sits, just inside its first corner.
function slotsOf(items: CanvasItem[], view: View, overlay: { left: number; top: number }): SlotMark[] {
  return items.flatMap((item) => {
    if (item.type !== "placeholder") return [];
    const at = corners(item).map((p) => toOverlay(view, overlay, p));
    return [{ clipId: item.clipId, name: item.slot ?? "", points: at.map((p) => `${px(p.x)},${px(p.y)}`).join(" "), left: px(at[0].x), top: px(at[0].y) }];
  });
}

// The outline of each selected clip drawn now, in the overlay's pixels.
function outlinesOf(items: CanvasItem[], selected: string[], view: View, overlay: { left: number; top: number }): Outline[] {
  return items
    .filter((item) => selected.includes(item.clipId))
    .map((item) => ({
      clipId: item.clipId,
      points: corners(item)
        .map((p) => toOverlay(view, overlay, p))
        .map((p) => `${px(p.x)},${px(p.y)}`)
        .join(" "),
    }));
}

// Teammates' outlines round the clips drawn now that they selected, at most two per clip, back to front, and a name
// pill per person by the top-most corner of their outline on the top-most of their clips. A clip with more people
// than outlines gets a "+N" pill beside its outer outline. No pills while the pane is not measured.
function peerMarksOf(
  items: CanvasItem[],
  peers: readonly Peer[],
  view: View,
  overlay: { left: number; top: number; width: number },
  visible: Box | null,
): PeerMarks {
  if (peers.length === 0) return NO_PEER_MARKS;
  const marks = clipMarks(peers);
  const peerOutlines: PeerOutline[] = [];
  const anchors = new Map<string, Point>();
  const crowded: { clipId: string; at: Point; more: number }[] = [];
  for (const item of items) {
    const on = marks.get(item.clipId);
    if (!on) continue;
    const rings = Array.from({ length: Math.min(on.length, PEERS_OUTLINED) }, (_, i) =>
      outsetCorners(item, (i + 1) * PEER_RING_PX, view.k)
        .map((p) => toOverlay(view, overlay, p))
        .map((p) => ({ x: px(p.x), y: px(p.y) })),
    );
    on.forEach((peer, i) => {
      const ring = rings[Math.min(i, rings.length - 1)];
      // Items run back to front, so the last clip a person is on is their top-most.
      anchors.set(peer.userId, topCorner(ring));
      if (i < PEERS_OUTLINED) {
        peerOutlines.push({ key: `${item.clipId}:${peer.userId}`, clipId: item.clipId, colour: peer.colour, points: ring.map((p) => `${p.x},${p.y}`).join(" ") });
      }
    });
    if (on.length > PEERS_OUTLINED) crowded.push({ clipId: item.clipId, at: topCorner(rings[rings.length - 1]), more: on.length - PEERS_OUTLINED });
  }
  if (!visible) return { peerOutlines, peerLabels: [] };

  const placed: { top: number; from: number; to: number }[] = [];
  const pill = (at: Point, text: string, beside: boolean) => {
    let top = at.y - PILL_GAP_PX - PILL_PX;
    if (top < visible.top + PILL_GAP_PX) top = at.y + PILL_GAP_PX;
    // A corner past the pane's edge, as on a clip larger than the view, still leaves its pill on screen.
    top = Math.min(Math.max(top, visible.top + PILL_GAP_PX), visible.bottom - PILL_GAP_PX - PILL_PX);
    // The width is a guess from the text; it only decides what counts as overlapping.
    const width = Math.min(PILL_MAX_PX, 8 + text.length * 6.5);
    let edge: { left: number } | { right: number };
    let from: number;
    if (beside && at.x - PILL_GAP_PX - width >= visible.left + PILL_GAP_PX) {
      from = at.x - PILL_GAP_PX - width;
      edge = { right: px(overlay.width - (at.x - PILL_GAP_PX)) };
    } else if (at.x > visible.right - PILL_MAX_PX) {
      const x = Math.min(at.x, visible.right - PILL_GAP_PX);
      from = x - width;
      edge = { right: px(overlay.width - x) };
    } else {
      from = Math.max(at.x, visible.left + PILL_GAP_PX);
      edge = { left: px(from) };
    }
    const to = from + width;
    const overlapping = () => placed.filter((p) => p.top < top + PILL_PX && top < p.top + PILL_PX && p.from < to && from < p.to);
    for (let over = overlapping(); over.length > 0; over = overlapping()) top = Math.max(...over.map((p) => p.top)) + PILL_STEP_PX;
    placed.push({ top, from, to });
    return { top: px(top), ...edge };
  };
  const peerLabels: PeerLabel[] = [];
  for (const peer of peers) {
    const at = anchors.get(peer.userId);
    if (at) peerLabels.push({ key: peer.userId, userId: peer.userId, text: peer.short, colour: peer.colour, ...pill(at, peer.short, false) });
  }
  for (const c of crowded) {
    const text = `+${c.more}`;
    peerLabels.push({ key: `more:${c.clipId}`, userId: null, text, colour: null, ...pill(c.at, text, true) });
  }
  return { peerOutlines, peerLabels };
}

// The highest corner on screen, the leftmost of a tie.
function topCorner(points: Point[]): Point {
  return points.reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a));
}

function sameOutlines(a: Outline[], b: Outline[]): boolean {
  return a.length === b.length && a.every((o, i) => o.clipId === b[i].clipId && o.points === b[i].points);
}
