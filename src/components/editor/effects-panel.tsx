"use client";

import { LocateFixed, Trash2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { parseNumber } from "@/lib/editor/inspector-fields";
import { clearKeyframesOps, deleteKeyframeOps, editKeyframeOps, keyframeRows } from "@/lib/editor/keyframe-list";
import { KEYFRAME_PROPS } from "@/lib/timeline/keyframes";
import type { Units } from "@/lib/editor/settings";
import { findClip, viewDoc, type EditorStore } from "@/lib/editor/store";
import { UNIT_SUFFIX, fromUnit, showUnit } from "@/lib/editor/units";
import { VOLUME_MAX, type Clip, type Ease, type Keyframe, type KeyframeProp, type OpInput } from "@/lib/timeline";
import { useEditor, useEditorStore, useSettings } from "./context";
import { AnimationSection, TransitionsSection } from "./effects-section";
import { KenBurnsButton, PROP_LABEL } from "./keyframe-button";

const TEXT = "text-[13px] leading-5";
const CAPTION = "text-xs font-medium text-ed-muted";
// Time, value, and the row's buttons.
const ROW = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1";

const EASES: { value: Ease; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "ease_in", label: "Ease in" },
  { value: "ease_out", label: "Ease out" },
  { value: "ease_in_out", label: "Ease in-out" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm leading-5 font-semibold text-ed-text">{title}</h2>
      {children}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className={cx(TEXT, "text-ed-muted")}>{children}</p>;
}

const round = (n: number, places: number) => Number(n.toFixed(places));
const seconds = (frames: number, fps: number) => (frames / fps).toFixed(2);

// One edit, one undo step, against the clip as saved now: a field typed in before a change from someone else still
// edits the keyframe it was showing, or nothing when that keyframe is gone.
function send(store: EditorStore, clipId: string, make: (clip: Clip) => OpInput[]): boolean {
  const clip = findClip(store.getState().doc, clipId)?.clip;
  if (!clip) return false;
  const ops = make(clip);
  return ops.length > 0 && store.getState().edit(ops, "keyframe").ok;
}

// A keyframe's value as Inspect shows it, and a typed number back as the value kept, or null when it changes nothing
// or cannot be kept. X and Y are fractions of the frame, shown in the unit chosen in Settings; scale and opacity are
// shares, shown in percent.
type ValueView = { shown: number; suffix: string; step: number; min?: number; max?: number; kept(typed: number): number | null };

function valueView(prop: KeyframeProp, value: number, units: Units, frame: { width: number; height: number }): ValueView {
  switch (prop) {
    case "x":
    case "y": {
      const side = prop === "x" ? frame.width : frame.height;
      const now = showUnit(value * side, units);
      return {
        shown: Number(now),
        suffix: UNIT_SUFFIX[units],
        step: units === "px" ? 1 : 0.1,
        kept(typed) {
          const px = fromUnit(typed, units);
          // A value typed as it is shown (the rounded number) never nudges the keyframe.
          return showUnit(px, units) === now ? null : round(px / side, 6);
        },
      };
    }
    case "scale":
      return {
        shown: round(value * 100, 1),
        suffix: "%",
        step: 1,
        min: 1,
        kept(typed) {
          const scale = round(typed / 100, 4);
          return scale > 0 ? scale : null;
        },
      };
    case "rotation":
      return { shown: round(value, 1), suffix: "°", step: 1, kept: (typed) => typed };
    case "opacity":
      return { shown: round(value * 100, 1), suffix: "%", step: 1, min: 0, max: 100, kept: (typed) => Math.min(1, Math.max(0, round(typed / 100, 4))) };
    case "volume":
      return { shown: Math.round(value * 100), suffix: "%", step: 10, min: 0, max: VOLUME_MAX * 100, kept: (typed) => Math.min(VOLUME_MAX, Math.max(0, Math.round(typed) / 100)) };
  }
}

// NumberInput reads the box with Number(), which also takes "0x10" and "1e2"; only plain decimals count, as in Inspect.
function typedIsPlain(box: HTMLInputElement | null, suffix: string): boolean {
  let text = box?.value.trim() ?? "";
  if (text.endsWith(suffix)) text = text.slice(0, -suffix.length);
  return parseNumber(text) !== null;
}

// A typed number, as NumberInput would commit it: plain decimals only, within min and max. null for anything else.
function typedNumber(text: string, suffix: string, min = -Infinity, max = Infinity): number | null {
  let t = text.trim();
  if (t.endsWith(suffix)) t = t.slice(0, -suffix.length);
  const n = parseNumber(t);
  return n === null ? null : Math.min(max, Math.max(min, n));
}

type RowProps = {
  clipId: string;
  prop: KeyframeProp;
  keyframe: Keyframe;
  fps: number;
  canEdit: boolean;
  onMoved(from: number, to: number): void; // the keyframe's time changed here
  onDelete(): void;
};

// One keyframe: its time from the clip's start in seconds, its value, the ease to the next keyframe, Go to and Delete.
function KeyframeRow({ clipId, prop, keyframe, fps, canEdit, onMoved, onDelete }: RowProps) {
  const store = useEditorStore();
  const units = useSettings((s) => s.units);
  const width = useEditor((s) => viewDoc(s).width);
  const height = useEditor((s) => viewDoc(s).height);
  const timeBox = useRef<HTMLInputElement>(null);
  const valueBox = useRef<HTMLInputElement>(null);
  const { at } = keyframe;
  const view = valueView(prop, keyframe.value, units, { width, height });
  const shownTime = Number(seconds(at, fps));
  const ease = keyframe.ease ?? "linear";
  const edit = (patch: { at?: number; value?: number; ease?: Ease }) => send(store, clipId, (clip) => editKeyframeOps(clip, prop, at, patch));

  // Typed seconds to the nearest frame. True when the keyframe moved.
  function saveTime(typed: number): boolean {
    const frames = Math.round(typed * fps) || 0; // never -0
    if (frames === at || !edit({ at: frames })) return false;
    onMoved(at, frames);
    return true;
  }

  function saveValue(typed: number) {
    const value = view.kept(typed);
    if (value !== null) edit({ value });
  }

  // A value typed and then left by selecting another clip (which selects on pointerdown, before the field's blur) is
  // saved to this row's clip as the field goes, as Inspect does. The boxes are the ones mounted; a box whose text is
  // what it shows holds no draft.
  const leave = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const time = timeBox.current;
    const value = valueBox.current;
    leave.current = () => {
      if (time && time.value.trim() !== String(shownTime)) {
        const typed = typedNumber(time.value, "s");
        if (typed !== null) saveTime(typed);
      }
      if (value && value.value.trim() !== String(view.shown)) {
        const typed = typedNumber(value.value, view.suffix, view.min, view.max);
        if (typed !== null) saveValue(typed);
      }
    };
  });
  useEffect(() => () => leave.current(), []);

  function goTo() {
    const state = store.getState();
    const clip = findClip(state.doc, clipId)?.clip;
    if (!clip) return;
    state.pause();
    state.seek(clip.start + at);
  }

  return (
    <div role="group" aria-label={`${PROP_LABEL[prop]} keyframe at ${seconds(at, fps)}s`} className="flex flex-col gap-1">
      <div className={ROW}>
        <NumberInput
          ref={timeBox}
          ariaLabel="Time"
          data-edit-control
          disabled={!canEdit}
          value={shownTime}
          suffix="s"
          step={1 / fps}
          onCommit={(typed) => {
            const box = timeBox.current;
            if (!typedIsPlain(box, "s")) return;
            const focused = box !== null && document.activeElement === box;
            let moved = false;
            flushSync(() => {
              moved = saveTime(typed);
            });
            // Enter or an arrow keeps typing here, even if the row moved: the arrows must not fall through to the
            // playhead's shortcuts.
            if (moved && focused && timeBox.current && document.activeElement !== timeBox.current) timeBox.current.focus();
          }}
        />
        <NumberInput
          ref={valueBox}
          ariaLabel="Value"
          data-edit-control
          disabled={!canEdit}
          value={view.shown}
          suffix={view.suffix}
          step={view.step}
          min={view.min}
          max={view.max}
          onCommit={(typed) => {
            if (typedIsPlain(valueBox.current, view.suffix)) saveValue(typed);
          }}
        />
        {/* Seeking changes nothing, so a viewer has it too. */}
        <IconButton label="Go to" onClick={goTo}>
          <LocateFixed />
        </IconButton>
      </div>
      <div className={ROW}>
        <Select
          aria-label="Ease"
          title="Easing shapes the move to the next keyframe"
          data-edit-control
          disabled={!canEdit}
          className="col-span-2"
          value={ease}
          onChange={(event) => edit({ ease: event.target.value as Ease })}
        >
          {EASES.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
          {/* Not offered, but an agent may set it; shown as it is rather than as Linear. */}
          {ease === "hold" && <option value="hold">Hold</option>}
        </Select>
        <IconButton label="Delete" data-edit-control data-delete disabled={!canEdit} onClick={onDelete}>
          <Trash2 />
        </IconButton>
      </div>
    </div>
  );
}

// Each row's React key: its time, unless its time was changed here, when it keeps the key it had so the row (and the
// focus in it) stays. A key that a moved row took is skipped by a row that comes to sit at its old time.
function rowKeys(keyframes: Keyframe[], moved: ReadonlyMap<number, string>): string[] {
  const taken = new Set(keyframes.flatMap((k) => (moved.has(k.at) ? [moved.get(k.at)!] : [])));
  return keyframes.map((k) => {
    const own = moved.get(k.at);
    if (own !== undefined) return own;
    let key = `at:${k.at}`;
    while (taken.has(key)) key += "+";
    return key;
  });
}

// After a Delete: the next row's Delete, or the property's Clear when it was the last row, or, when the property has
// no keyframes left, the Clear of the property after it (or before it).
function focusAfterDelete(section: Element | null, prop: KeyframeProp, index: number) {
  if (!section) return;
  const group = section.querySelector(`[data-prop="${prop}"]`);
  if (group) {
    const next = group.querySelectorAll<HTMLElement>("[data-delete]")[index] ?? group.querySelector<HTMLElement>("[data-clear]");
    next?.focus();
    return;
  }
  const clears = [...section.querySelectorAll<HTMLElement>("[data-clear]")];
  const order = (el: HTMLElement) => KEYFRAME_PROPS.indexOf(el.closest("[data-prop]")?.getAttribute("data-prop") as KeyframeProp);
  (clears.find((el) => order(el) > KEYFRAME_PROPS.indexOf(prop)) ?? clears.at(-1))?.focus();
}

function PropertyKeyframes({ clipId, prop, keyframes, fps, canEdit }: { clipId: string; prop: KeyframeProp; keyframes: Keyframe[]; fps: number; canEdit: boolean }) {
  const store = useEditorStore();
  const headingId = useId();
  const group = useRef<HTMLDivElement>(null);
  const [moved, setMoved] = useState<ReadonlyMap<number, string>>(new Map());
  const keys = rowKeys(keyframes, moved);

  function onMoved(index: number, from: number, to: number) {
    const key = keys[index];
    setMoved((m) => {
      const next = new Map(m);
      next.delete(from);
      next.set(to, key);
      return next;
    });
  }

  function remove(index: number, at: number) {
    const section = group.current?.closest("[data-keyframes]") ?? null;
    flushSync(() => {
      send(store, clipId, (clip) => deleteKeyframeOps(clip, prop, at));
    });
    focusAfterDelete(section, prop, index);
  }

  return (
    <div ref={group} role="group" aria-labelledby={headingId} data-prop={prop} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className={cx(TEXT, "font-medium text-ed-text")}>
          {PROP_LABEL[prop]}
        </h3>
        <Button variant="ghost" size="sm" data-edit-control data-clear disabled={!canEdit} onClick={() => send(store, clipId, (clip) => clearKeyframesOps(clip, prop))}>
          Clear
        </Button>
      </div>
      <div aria-hidden className={cx(ROW, CAPTION)}>
        <span>Time</span>
        <span>Value</span>
        <span className="w-7" />
      </div>
      <div className="flex flex-col gap-2">
        {keyframes.map((k, i) => (
          <KeyframeRow
            key={keys[i]}
            clipId={clipId}
            prop={prop}
            keyframe={k}
            fps={fps}
            canEdit={canEdit}
            onMoved={(from, to) => onMoved(i, from, to)}
            onDelete={() => remove(i, k.at)}
          />
        ))}
      </div>
    </div>
  );
}

// Every keyframed property of the clip, each with its keyframes in time order; then Ken Burns for an image.
function KeyframesSection({ clip }: { clip: Clip }) {
  const canEdit = useEditor((s) => s.canEdit);
  const fps = useEditor((s) => viewDoc(s).fps);
  const rows = keyframeRows(clip);
  return (
    <Section title="Keyframes">
      {rows.length === 0 ? (
        <Hint>No keyframes yet. Use the ◆ beside a field in Inspect to add one.</Hint>
      ) : (
        <div data-keyframes className="flex flex-col gap-4">
          {rows.map((r) => (
            <PropertyKeyframes key={r.prop} clipId={clip.id} prop={r.prop} keyframes={r.keyframes} fps={fps} canEdit={canEdit} />
          ))}
        </div>
      )}
      {clip.type === "image" && (
        <div className="flex flex-col items-start">
          <KenBurnsButton clipId={clip.id} />
        </div>
      )}
    </Section>
  );
}

function ClipEffects({ clip }: { clip: Clip }) {
  return (
    <>
      {/* A visual slot carries its transitions over to the clip that fills it. */}
      {(clip.type === "video" || clip.type === "image" || clip.type === "shape" || clip.type === "placeholder") && <TransitionsSection clip={clip} />}
      {clip.type === "text" && <AnimationSection clip={clip} />}
      <KeyframesSection clip={clip} />
    </>
  );
}

const drawsOnCanvas = (clip: Clip) => clip.type !== "audio" && !(clip.type === "placeholder" && clip.accepts === "audio");

// The selected clip's transitions or text animation, and its keyframes.
export function EffectsPanel() {
  const count = useEditor((s) => s.selection.clipIds.length);
  const clip = useEditor((s) => {
    const ids = s.selection.clipIds;
    return ids.length === 1 ? (findClip(viewDoc(s), ids[0])?.clip ?? null) : null;
  });

  let body: ReactNode;
  // Keyed by the clip, so a value typed for one clip never lands on the next one selected.
  if (clip && drawsOnCanvas(clip)) body = <ClipEffects key={clip.id} clip={clip} />;
  // A sound has no picture to move, but its volume can be keyed.
  else if (clip?.type === "audio") body = <KeyframesSection key={clip.id} clip={clip} />;
  else if (clip) body = <Hint>An empty audio slot has no effects.</Hint>;
  else if (count > 1) body = <Hint>Select one clip to see its effects.</Hint>;
  else body = <Hint>Select a clip to see its effects.</Hint>;

  return <div className="flex flex-col gap-4 p-3">{body}</div>;
}
