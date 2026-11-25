"use client";

import { Link2, Link2Off } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FOCUS_RING, SWATCH_BOX, cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { NumberInput } from "@/components/ui/number-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { Toggle } from "@/components/ui/toggle";
import { gainLabel } from "@/lib/audio/loudness";
import { applyLook, cleanUpSelection, duckSelection, freezeFrame, toggleMarker, removeTrack, renameTrack, resetCrop, reverseSelection, separateAudio, toggleTrack } from "@/lib/editor/actions";
import { formatClock, trackToggles } from "@/lib/editor/geometry";
import {
  ADJUST_RANGE,
  TONE_DB,
  FIELD_LABEL,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  SPEED_PERCENT,
  lookRange,
  slipRange,
  weightOptions,
  clipFieldValue,
  cropScrubRange,
  fieldContext,
  parseNumber,
  scrubBounds,
  type ClipField,
} from "@/lib/editor/inspector-fields";
import { mediaLengthFrames } from "@/lib/editor/media-clips";
import { clipFrame } from "@/lib/editor/keyframe-edit";
import { markerAt, sortedMarkers } from "@/lib/editor/markers";
import { explainOpError } from "@/lib/editor/messages";
import { TRACK_KIND_LABEL } from "@/lib/editor/placement";
import { soundClipsOf } from "@/lib/editor/sound";
import { fxOf } from "@/lib/render/clip-sound";
import { rateLabel, rateOf } from "@/lib/editor/speed";
import { findClip, viewDoc, type EditorStore } from "@/lib/editor/store";
import type { Units } from "@/lib/editor/settings";
import { UNIT_DECIMALS, UNIT_SUFFIX, toUnit } from "@/lib/editor/units";
import { LIMITS } from "@/lib/limits";
import { formatLength } from "@/lib/media/messages";
import { PLACEHOLDER_LABELS } from "@/lib/media/playback";
import { BLEND_LABEL, BLEND_MODES, LOOKS, NO_ADJUST, VOLUME_MAX, docDuration, isAdjusted, isCropped, isMediaClip, lookOf, type Clip, type KeyframeProp, type Marker, type MediaClip, type ShapeClip, type Track } from "@/lib/timeline";
import { SHAPE_COLOR, arrowLook, arrowThrough, shapeName, takesRadius } from "@/lib/timeline/shapes";
import { volumeAt } from "@/lib/timeline/keyframes";
import { hasBackground, hasOutline, hasShadow, textExtras } from "@/lib/timeline/text-style";
import { useEditor, useEditorStore, useSettings, useSettingsStore } from "./context";
import { FontSelect } from "./font-select";
import { FormatFields } from "./format-select";
import { KeyframeButton, KeyframeSteps } from "./keyframe-button";
import { useLibrary, useMedia } from "./media/media-context";
import { SlotSection } from "./slot-section";
import { useTextMeasure } from "./text-measure";
import { Timecode } from "./timecode";
import { fieldOps, useFieldGesture, useTextField, type FieldView } from "./use-field-gesture";
import { useLevelVolume } from "./use-level-volume";

const TEXT = "text-[13px] leading-5";
const CAPTION = "text-xs font-medium text-ed-muted";

const MEDIA_TITLE: Record<Exclude<Clip["type"], "text" | "placeholder" | "shape">, string> = {
  video: "Video clip",
  image: "Image",
  audio: "Audio clip",
};

const ALIGN_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
] as const;

type Align = (typeof ALIGN_OPTIONS)[number]["value"];

const HEX = /^#[0-9a-f]{6}$/; // what a color input accepts

// Select, Segmented and Toggle change the project at once.
function editField(store: EditorStore, clipId: string, field: ClipField, raw: string) {
  const ops = fieldOps(store, clipId, field, raw);
  if (ops && ops.length > 0) store.getState().edit(ops, FIELD_LABEL[field]);
}

// actions: controls at the right of the heading.
function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const heading = <h2 className="text-sm leading-5 font-semibold text-ed-text">{title}</h2>;
  return (
    <div className="flex flex-col gap-2">
      {actions ? (
        <div className="flex items-center justify-between gap-2">
          {heading}
          {actions}
        </div>
      ) : (
        heading
      )}
      {children}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className={cx(TEXT, "text-ed-muted")}>{children}</p>;
}

// How a field's value is dragged: the change per CSS px, and the places it is rounded to. X, Y, Width and Height move a
// project pixel per CSS pixel, in the chosen unit; a crop side half a percent; Start and Length a frame.
function scrubOf(field: ClipField, units: Units, fps: number): { scrub: number; decimals: number } | null {
  switch (field) {
    case "x":
    case "y":
    case "width":
    case "height":
      return { scrub: toUnit(1, units), decimals: UNIT_DECIMALS[units] };
    case "fontSize":
    case "scale":
    case "rotation":
    case "opacity":
    case "radius":
      return { scrub: 1, decimals: 1 };
    case "strokeWidth":
      return { scrub: 0.5, decimals: 1 };
    case "headSize":
      return { scrub: 0.05, decimals: 1 };
    case "bend":
      return { scrub: 0.5, decimals: 0 };
    case "cropLeft":
    case "cropTop":
    case "cropRight":
    case "cropBottom":
      return { scrub: 0.5, decimals: 1 };
    case "start":
    case "duration":
    case "sourceIn":
    case "fadeIn":
    case "fadeOut":
      return { scrub: 1 / fps, decimals: 2 };
    case "volume":
    case "pan":
    case "speed":
    case "rounding":
    case "chromaTolerance":
    case "chromaSoftness":
    case "brightness":
    case "contrast":
    case "saturation":
    case "temperature":
    case "vignette":
    case "hue":
    case "blur":
    case "lookStrength":
    case "shadowOpacity":
    case "backgroundOpacity":
    case "backgroundPadding":
    case "backgroundRadius":
    case "letterSpacing":
      return { scrub: 1, decimals: 0 };
    case "soundGate":
    case "soundCompress":
      return { scrub: 1, decimals: 0 };
    case "soundBass":
    case "soundMid":
    case "soundTreble":
      return { scrub: 0.5, decimals: 1 };
    case "lineHeight":
      return { scrub: 0.01, decimals: 2 };
    case "outlineWidth":
      return { scrub: 0.5, decimals: 1 };
    case "shadowBlur":
    case "shadowX":
    case "shadowY":
      return { scrub: 1, decimals: 0 };
    default:
      return null;
  }
}

// A number field of the clip. Typing previews the change; Enter, blur or an arrow key saves it. Dragged sideways, it
// previews each value and saves one change when let go.
function NumberField(props: {
  clipId: string;
  field: ClipField;
  label: string;
  suffix: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const { clipId, field, label, suffix, ...rest } = props;
  const store = useEditorStore();
  const { library } = useMedia();
  const canEdit = useEditor((s) => s.canEdit);
  const units = useSettings((s) => s.units);
  const lockAspect = useSettings((s) => s.lockAspect);
  const fps = useEditor((s) => s.doc.fps);
  const measure = useTextMeasure();
  // A video or image is measured by its picture's size as the library knows it; until then, the placeholder's frame.
  const assetId = useEditor((s) => {
    const clip = findClip(viewDoc(s), clipId)?.clip;
    return clip && isMediaClip(clip) ? clip.assetId : null;
  });
  const sourceWidth = useLibrary((s) => (assetId === null ? null : (s.assets[assetId]?.width ?? null)));
  const sourceHeight = useLibrary((s) => (assetId === null ? null : (s.assets[assetId]?.height ?? null)));
  const view: FieldView = {
    prefs: { units, lockAspect },
    sizer: { source: () => (sourceWidth !== null && sourceHeight !== null ? { width: sourceWidth, height: sourceHeight } : null), measure },
  };
  const box = useRef<HTMLInputElement>(null);
  const gesture = useFieldGesture(store, clipId, field);
  const { live } = gesture;
  // While the field previews its own value, it is given the saved value, so a commit compares what
  // was typed with what is stored. Otherwise it follows the view, such as a drag on the timeline.
  const shown = useEditor((s) => {
    const doc = live !== null && s.gesture?.ops === live ? s.doc : viewDoc(s);
    const found = findClip(doc, clipId);
    return found ? clipFieldValue(found.clip, field, fieldContext(doc, found.clip, view.prefs, view.sizer, s.playhead)) : "";
  });

  const drag = scrubOf(field, units, fps);
  // Start and Length stop at the neighbouring clips, and a crop side where its opposite leaves 5%, as they are when the
  // press starts.
  let scrubRange: (() => { min: number; max: number }) | undefined;
  if (field === "start" || field === "duration") {
    scrubRange = () => {
      const { doc } = store.getState();
      const clip = findClip(doc, clipId)?.clip;
      const lengthFrames = clip && isMediaClip(clip) ? mediaLengthFrames(library.getState().assets[clip.assetId], doc.fps) : undefined;
      return scrubBounds(doc, clipId, field, lengthFrames);
    };
  } else if (field === "cropLeft" || field === "cropTop" || field === "cropRight" || field === "cropBottom") {
    scrubRange = () => {
      const clip = findClip(store.getState().doc, clipId)?.clip;
      return clip ? cropScrubRange(clip, field) : { min: -Infinity, max: Infinity };
    };
  } else if (field === "fadeIn" || field === "fadeOut") {
    // A fade is never longer than its clip.
    scrubRange = () => {
      const { doc } = store.getState();
      return { min: 0, max: (findClip(doc, clipId)?.clip.duration ?? 0) / doc.fps };
    };
  } else if (field === "volume") {
    scrubRange = () => ({ min: 0, max: VOLUME_MAX * 100 });
  } else if (field === "pan") {
    scrubRange = () => ({ min: -100, max: 100 });
  } else if (field === "sourceIn") {
    // The footage stops slipping where the clip would run out of it.
    scrubRange = () => {
      const { doc } = store.getState();
      const clip = findClip(doc, clipId)?.clip;
      if (!clip || !isMediaClip(clip)) return { min: 0, max: Infinity };
      const range = slipRange(clip, mediaLengthFrames(library.getState().assets[clip.assetId], doc.fps));
      return { min: range.min / doc.fps, max: range.max / doc.fps };
    };
  } else if (field === "speed") {
    scrubRange = () => SPEED_PERCENT;
  } else if (field === "rounding" || field === "chromaTolerance" || field === "chromaSoftness" || field === "soundGate" || field === "soundCompress") {
    scrubRange = () => ({ min: 0, max: 100 });
  } else if (field === "soundBass" || field === "soundMid" || field === "soundTreble") {
    scrubRange = () => ({ min: -TONE_DB, max: TONE_DB });
  } else if (Object.hasOwn(ADJUST_RANGE, field)) {
    const { min, max } = ADJUST_RANGE[field as keyof typeof ADJUST_RANGE];
    scrubRange = () => ({ min, max });
  } else {
    const range = lookRange(field);
    if (range) scrubRange = () => range;
  }

  // NumberInput reads the box with Number(), which also takes "0x10" and "1e2"; only plain decimals count.
  function typedIsPlain(): boolean {
    let text = box.current?.value.trim() ?? "";
    if (text.endsWith(suffix)) text = text.slice(0, -suffix.length);
    return parseNumber(text) !== null;
  }

  return (
    <Field label={label}>
      {/* The unit sits inside the label, so the field is named on its own. */}
      <NumberInput
        ref={box}
        ariaLabel={label}
        data-edit-control
        disabled={!canEdit}
        value={Number(shown)}
        suffix={suffix}
        scrub={drag?.scrub}
        decimals={drag?.decimals}
        scrubRange={scrubRange}
        onPreview={(v, how) => {
          // A dragged value is a number the field made, not text that was typed.
          if (v === null || (!how?.scrubbed && !typedIsPlain())) {
            gesture.drop();
            return;
          }
          return gesture.preview(fieldOps(store, clipId, field, String(v), library, view));
        }}
        onCommit={(v, how) => {
          const ops = how?.scrubbed || typedIsPlain() ? fieldOps(store, clipId, field, String(v), library, view) : null;
          if (ops === null) {
            gesture.drop();
            store.getState().notify("error", explainOpError("INVALID"));
            return;
          }
          // Previewed again before saving: the committed value may have been clamped.
          gesture.preview(ops);
          gesture.finish();
        }}
        {...rest}
      />
    </Field>
  );
}

// The native color input previews while the picker moves and saves when it closes. field: a text clip's colour, or a
// shape's outline or fill.
type ColorFieldName = "color" | "stroke" | "fill" | "outlineColor" | "shadowColor" | "backgroundColor" | "chromaColor";

function ColorField({ clip, canEdit, field = "color", label = "Color" }: { clip: Clip; canEdit: boolean; field?: ColorFieldName; label?: string }) {
  const store = useEditorStore();
  const swatch = useRef<HTMLInputElement>(null);
  const shown = clipFieldValue(clip, field, fieldContext(viewDoc(store.getState()), clip));
  const hex = useTextField(store, clip.id, field, shown);
  const picked = useFieldGesture(store, clip.id, field);

  // React's onChange follows the input event, so the closing change event is listened for here,
  // afresh after each render so it sees this render's gesture.
  useEffect(() => {
    const input = swatch.current;
    if (!input) return;
    function onChange() {
      if (!input) return;
      // Previewed again first, so the save never depends on which handler ran first.
      picked.preview(fieldOps(store, clip.id, field, input.value));
      picked.finish();
    }
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  });

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={CAPTION}>{label}</span>
      <div className="flex min-w-0 gap-2">
        <input
          ref={swatch}
          type="color"
          aria-label={label}
          data-edit-control
          disabled={!canEdit}
          value={HEX.test(shown) ? shown : "#000000"}
          onChange={(event) => {
            // The closing change event is saved by the listener above.
            if (event.nativeEvent.type === "change") return;
            picked.preview(fieldOps(store, clip.id, field, event.target.value));
          }}
          className={SWATCH_BOX}
        />
        <TextInput
          aria-label={field === "color" ? "Hex color" : `${label} hex`}
          data-edit-control
          disabled={!canEdit}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
          value={hex.value}
          onChange={(event) => hex.change(event.target.value)}
          onBlur={hex.save}
          onKeyDown={(event) => hex.onKeyDown(event)}
        />
      </div>
    </div>
  );
}

// The clip's font, from the menu the Captions tab shares.
function FontField({ clip, canEdit }: { clip: Clip; canEdit: boolean }) {
  const store = useEditorStore();
  if (clip.type !== "text") return null;
  return (
    <Field label="Font">
      <FontSelect data-edit-control disabled={!canEdit} family={clip.style.fontFamily} onPick={(family) => editField(store, clip.id, "fontFamily", family)} />
    </Field>
  );
}

function TextSection({ clip, canEdit }: { clip: Clip; canEdit: boolean }) {
  const store = useEditorStore();
  const text = useTextField(store, clip.id, "text", clipFieldValue(clip, "text", fieldContext(viewDoc(store.getState()), clip)));
  if (clip.type !== "text") return null;
  const weight = clip.style.fontWeight;
  const weights = weightOptions(clip.style.fontFamily, weight);
  const look = textExtras(clip.style);
  const outlined = hasOutline(look);
  const shadowed = hasShadow(look);
  const boxed = hasBackground(look);
  const toggle = (field: ClipField, on: boolean) => editField(store, clip.id, field, on ? "on" : "off");

  return (
    <Section title="Text">
      <Field label="Text">
        <TextArea
          data-edit-control
          disabled={!canEdit}
          rows={3}
          maxLength={LIMITS.textClipChars}
          value={text.value}
          onChange={(event) => text.change(event.target.value)}
          onBlur={text.save}
          onKeyDown={(event) => text.onKeyDown(event, true)}
        />
      </Field>
      <FontField clip={clip} canEdit={canEdit} />
      <div className="grid grid-cols-2 gap-2">
        <NumberField clipId={clip.id} field="fontSize" label="Size" suffix="px" min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} />
        <Field label="Weight">
          <Select
            data-edit-control
            disabled={!canEdit}
            value={String(weight)}
            onChange={(event) => editField(store, clip.id, "fontWeight", event.target.value)}
          >
            {weights.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ColorField clip={clip} canEdit={canEdit} />
      <div className="flex min-w-0 items-center gap-2">
        <span className={cx(CAPTION, "w-12 shrink-0")}>Align</span>
        <Segmented<Align>
          label="Align"
          data-edit-control
          disabled={!canEdit}
          className="flex-1"
          value={clip.style.align}
          options={[...ALIGN_OPTIONS]}
          onChange={(align) => editField(store, clip.id, "align", align)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Toggle label="Italic" data-edit-control checked={clip.style.italic ?? false} disabled={!canEdit} onChange={(on) => toggle("italic", on)} />
        <Toggle label="Underline" data-edit-control checked={clip.style.underline ?? false} disabled={!canEdit} onChange={(on) => toggle("underline", on)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField clipId={clip.id} field="letterSpacing" label="Letter spacing" suffix="%" min={-20} max={200} />
        <NumberField clipId={clip.id} field="lineHeight" label="Line height" suffix="×" min={0.5} max={4} step={0.1} />
      </div>
      <Toggle label="Outline" data-edit-control checked={outlined} disabled={!canEdit} onChange={(on) => toggle("outline", on)} />
      {outlined && (
        <div className="grid grid-cols-2 items-end gap-2">
          <ColorField clip={clip} canEdit={canEdit} field="outlineColor" label="Outline color" />
          <NumberField clipId={clip.id} field="outlineWidth" label="Outline width" suffix="px" min={0} max={200} />
        </div>
      )}
      <Toggle label="Shadow" data-edit-control checked={shadowed} disabled={!canEdit} onChange={(on) => toggle("shadow", on)} />
      {shadowed && (
        <>
          <ColorField clip={clip} canEdit={canEdit} field="shadowColor" label="Shadow color" />
          <div className="grid grid-cols-2 gap-2">
            <NumberField clipId={clip.id} field="shadowOpacity" label="Shadow opacity" suffix="%" min={0} max={100} />
            <NumberField clipId={clip.id} field="shadowBlur" label="Shadow blur" suffix="px" min={0} max={400} />
            <NumberField clipId={clip.id} field="shadowX" label="Shadow X" suffix="px" min={-1000} max={1000} />
            <NumberField clipId={clip.id} field="shadowY" label="Shadow Y" suffix="px" min={-1000} max={1000} />
          </div>
        </>
      )}
      <Toggle label="Background" data-edit-control checked={boxed} disabled={!canEdit} onChange={(on) => toggle("background", on)} />
      {boxed && (
        <>
          <ColorField clip={clip} canEdit={canEdit} field="backgroundColor" label="Background color" />
          <div className="grid grid-cols-3 gap-2">
            <NumberField clipId={clip.id} field="backgroundOpacity" label="Opacity" suffix="%" min={0} max={100} />
            <NumberField clipId={clip.id} field="backgroundPadding" label="Padding" suffix="%" min={0} max={300} />
            <NumberField clipId={clip.id} field="backgroundRadius" label="Rounding" suffix="%" min={0} max={200} />
          </div>
        </>
      )}
    </Section>
  );
}

const DASH_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
] as const;
const HEADS_OPTIONS = [
  { value: "end", label: "End" },
  { value: "start", label: "Start" },
  { value: "both", label: "Both" },
  { value: "none", label: "None" },
] as const;
const HEAD_OPTIONS = [
  { value: "triangle", label: "Triangle" },
  { value: "open", label: "Open" },
  { value: "bar", label: "Bar" },
] as const;
const PATH_OPTIONS = [
  { value: "straight", label: "Straight" },
  { value: "curved", label: "Curved" },
] as const;

// A labelled row holding a set of buttons, one of them on.
function Choice<T extends string>(props: { label: string; value: T; options: readonly { value: T; label: string }[]; canEdit: boolean; onChange(value: T): void }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={cx(CAPTION, "w-12 shrink-0")}>{props.label}</span>
      <Segmented<T> label={props.label} data-edit-control disabled={!props.canEdit} className="flex-1" value={props.value} options={[...props.options]} onChange={props.onChange} />
    </div>
  );
}

// A shape's look: its outline (which can be turned off while it has a fill), its width, dashes and corner rounding,
// and its fill; an arrow's or line's colour, width and dashes, its heads, their look and size, and whether it is
// straight or curved. A curved line is shaped by its points on the preview; with one point, Bend says how far out.
function ShapeSection({ clip, canEdit }: { clip: ShapeClip; canEdit: boolean }) {
  const store = useEditorStore();
  const box = clip.shape !== "arrow";
  const look = arrowLook(clip);
  const through = box ? 0 : arrowThrough(clip).length;
  const rounds = takesRadius(clip.shape);
  const outlined = clip.stroke !== null;
  const filled = clip.fill != null;
  const edit = (field: ClipField) => (value: string) => editField(store, clip.id, field, value);
  return (
    <Section title={shapeName(clip)}>
      {box && (
        <Toggle
          label="Outline"
          data-edit-control
          checked={outlined}
          // The last thing a shape shows can't be turned off.
          disabled={!canEdit || (outlined && !filled)}
          onChange={(on) => editField(store, clip.id, "stroke", on ? (clip.fill ?? SHAPE_COLOR) : "")}
        />
      )}
      {outlined && (
        <>
          <ColorField clip={clip} canEdit={canEdit} field="stroke" label={box ? "Outline color" : "Color"} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField clipId={clip.id} field="strokeWidth" label={box ? "Outline width" : "Line width"} suffix="px" min={1} max={LIMITS.shapeStrokeMax} />
            {rounds && <NumberField clipId={clip.id} field="radius" label="Rounding" suffix="px" min={0} />}
          </div>
          <Choice label="Style" value={clip.dash} options={DASH_OPTIONS} canEdit={canEdit} onChange={edit("dash")} />
        </>
      )}
      {!outlined && rounds && <NumberField clipId={clip.id} field="radius" label="Rounding" suffix="px" min={0} />}
      {box && (
        <>
          <Toggle
            label="Fill"
            data-edit-control
            checked={filled}
            disabled={!canEdit || (filled && !outlined)}
            onChange={(on) => editField(store, clip.id, "fill", on ? (clip.stroke ?? SHAPE_COLOR) : "")}
          />
          {filled && <ColorField clip={clip} canEdit={canEdit} field="fill" label="Fill color" />}
        </>
      )}
      {!box && (
        <>
          <Choice label="Heads" value={look.heads} options={HEADS_OPTIONS} canEdit={canEdit} onChange={edit("heads")} />
          {look.heads !== "none" && (
            <>
              <Choice label="Head" value={look.head} options={HEAD_OPTIONS} canEdit={canEdit} onChange={edit("head")} />
              <NumberField clipId={clip.id} field="headSize" label="Head size" suffix="×" min={1} max={8} step={0.5} />
            </>
          )}
          <Choice label="Path" value={through === 0 ? "straight" : "curved"} options={PATH_OPTIONS} canEdit={canEdit} onChange={edit("path")} />
          {through === 1 && (
            <NumberField clipId={clip.id} field="bend" label="Bend" suffix="%" min={-LIMITS.arrowPointReach * 100} max={LIMITS.arrowPointReach * 100} />
          )}
          <p className={cx(TEXT, "text-ed-muted")}>
            {through === 0
              ? "Drag the small dot on the line to curve it."
              : `${through === 1 ? "1 point" : `${through} points`}. Drag a point anywhere and the line passes through it. Drag a small dot to add one; double-click a point to remove it.`}
          </p>
        </>
      )}
    </Section>
  );
}

// A field with its keyframe diamond beside it.
function Keyed({ clipId, prop, children }: { clipId: string; prop: KeyframeProp; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-end gap-1">
      <div className="min-w-0 flex-1">{children}</div>
      <KeyframeButton clipId={clipId} prop={prop} />
    </div>
  );
}

// X and Y place the clip's centre, and Width and Height give its drawn size, in the unit chosen in Settings. An arrow
// moves them a pixel, or a tenth of a centimetre or inch. The fields show the clip at the playhead; a keyframed one is
// changed by keying it there.
// A shape's Width and Height are its own size (an arrow's is one Length), which never thickens its outline.
// lengthLabel: an arrow's or line's single size field, named so it is not taken for Timing's Length.
function PositionSection({ clipId, lengthLabel }: { clipId: string; lengthLabel?: string }) {
  const settings = useSettingsStore();
  const units = useSettings((s) => s.units);
  const lockAspect = useSettings((s) => s.lockAspect);
  const canEdit = useEditor((s) => s.canEdit);
  const length = { suffix: UNIT_SUFFIX[units], step: units === "px" ? 1 : 0.1 };
  return (
    <Section title="Position" actions={<KeyframeSteps clipId={clipId} />}>
      <div className="grid grid-cols-2 gap-2">
        <Keyed clipId={clipId} prop="x">
          <NumberField clipId={clipId} field="x" label="X" {...length} />
        </Keyed>
        <Keyed clipId={clipId} prop="y">
          <NumberField clipId={clipId} field="y" label="Y" {...length} />
        </Keyed>
      </div>
      {lengthLabel ? (
        <NumberField clipId={clipId} field="width" label={lengthLabel} {...length} />
      ) : (
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-1">
        <NumberField clipId={clipId} field="width" label="Width" {...length} />
        <IconButton
          label="Lock aspect ratio"
          pressed={lockAspect}
          data-edit-control
          disabled={!canEdit}
          onClick={() => settings.getState().set({ lockAspect: !lockAspect })}
        >
          {lockAspect ? <Link2 /> : <Link2Off />}
        </IconButton>
        <NumberField clipId={clipId} field="height" label="Height" {...length} />
      </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Keyed clipId={clipId} prop="scale">
          <NumberField clipId={clipId} field="scale" label="Scale" suffix="%" min={1} />
        </Keyed>
        <Keyed clipId={clipId} prop="rotation">
          <NumberField clipId={clipId} field="rotation" label="Rotation" suffix="°" />
        </Keyed>
        <Keyed clipId={clipId} prop="opacity">
          <NumberField clipId={clipId} field="opacity" label="Opacity" suffix="%" min={0} max={100} />
        </Keyed>
      </div>
    </Section>
  );
}

// The share cut from each side of the clip's whole picture or text box, each side leaving at least 5% against the
// other. Reset crop shows the whole clip again.
function CropSection({ clipId }: { clipId: string }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const cropped = useEditor((s) => isCropped(findClip(viewDoc(s), clipId)?.clip.transform.crop));
  const side = { suffix: "%", min: 0, max: 95 };
  return (
    <Section title="Crop">
      <div className="grid grid-cols-2 gap-2">
        <NumberField clipId={clipId} field="cropLeft" label="Crop left" {...side} />
        <NumberField clipId={clipId} field="cropTop" label="Crop top" {...side} />
        <NumberField clipId={clipId} field="cropRight" label="Crop right" {...side} />
        <NumberField clipId={clipId} field="cropBottom" label="Crop bottom" {...side} />
      </div>
      <div className="flex flex-col items-start">
        <Button data-edit-control disabled={!canEdit || !cropped} onClick={() => resetCrop(store, clipId)}>
          Reset crop
        </Button>
      </div>
    </Section>
  );
}

// slips: a video or audio clip, which can also slip: start from another moment of its file, keeping its place and length.
function TimingSection({ clipId, slips }: { clipId: string; slips: boolean }) {
  return (
    <Section title="Timing">
      <div className="grid grid-cols-2 gap-2">
        <NumberField clipId={clipId} field="start" label="Start" suffix="s" min={0} step={0.1} />
        <NumberField clipId={clipId} field="duration" label="Length" suffix="s" min={0} step={0.1} />
        {slips && <NumberField clipId={clipId} field="sourceIn" label="Footage from" suffix="s" min={0} step={0.1} />}
      </div>
    </Section>
  );
}

// A clip's sound clean-up: one button that sets it for a voice, and each part on its own. A rumble filter, a noise
// gate that turns the gaps between words down, a compressor that brings loud and quiet closer together, and three
// tone bands. It is heard in the preview and is in the export.
function CleanUp({ clip }: { clip: MediaClip }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const cleaned = fxOf(clip) !== null;
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Clean up">
      <div className="flex items-center justify-between gap-2">
        <span className={CAPTION}>Clean up</span>
        <div className="flex gap-2">
          {cleaned && (
            <Button data-edit-control variant="ghost" disabled={!canEdit} onClick={() => cleanUpSelection(store, true)}>
              Reset
            </Button>
          )}
          <Button data-edit-control disabled={!canEdit} onClick={() => cleanUpSelection(store)}>
            Clean up voice
          </Button>
        </div>
      </div>
      <Toggle label="Cut rumble" data-edit-control checked={clip.sound?.lowCut ?? false} disabled={!canEdit} onChange={(on) => editField(store, clip.id, "soundLowCut", on ? "on" : "off")} />
      <div className="grid grid-cols-2 gap-2">
        <NumberField clipId={clip.id} field="soundGate" label="Noise gate" suffix="%" min={0} max={100} step={5} />
        <NumberField clipId={clip.id} field="soundCompress" label="Compressor" suffix="%" min={0} max={100} step={5} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField clipId={clip.id} field="soundBass" label="Bass" suffix="dB" min={-TONE_DB} max={TONE_DB} step={1} />
        <NumberField clipId={clip.id} field="soundMid" label="Presence" suffix="dB" min={-TONE_DB} max={TONE_DB} step={1} />
        <NumberField clipId={clip.id} field="soundTreble" label="Treble" suffix="dB" min={-TONE_DB} max={TONE_DB} step={1} />
      </div>
    </div>
  );
}

// A video or audio clip's sound: how loud it is, in percent of as recorded (past 100 turns it up, to four times), how
// long it fades in and out, and two buttons. Level volume listens to the clip and sets its volume to the level every
// leveled clip gets; Separate audio, on a video, moves its sound to an audio clip of its own. A video whose file has no
// sound says so instead.
function SoundSection({ clip }: { clip: MediaClip }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const hasSound = useLibrary((s) => s.assets[clip.assetId]?.hasAudio !== false);
  const volume = useEditor((s) => volumeAt(clip, clipFrame(clip, s.playhead))); // what it is at the playhead, keyframes counted in
  const { level, busy } = useLevelVolume();
  if (!hasSound) {
    return (
      <Section title="Sound">
        <Hint>This file has no sound.</Hint>
      </Section>
    );
  }
  return (
    <Section title="Sound">
      <div className="grid grid-cols-2 items-end gap-2">
        <Keyed clipId={clip.id} prop="volume">
          <NumberField clipId={clip.id} field="volume" label="Volume" suffix="%" min={0} max={VOLUME_MAX * 100} step={10} />
        </Keyed>
        <p className={cx(TEXT, "pb-1 text-ed-muted tabular-nums")}>{volume === 1 ? "As recorded" : gainLabel(volume)}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField clipId={clip.id} field="fadeIn" label="Fade in" suffix="s" min={0} step={0.1} />
        <NumberField clipId={clip.id} field="fadeOut" label="Fade out" suffix="s" min={0} step={0.1} />
        <NumberField clipId={clip.id} field="pan" label="Pan (left − right +)" suffix="%" min={-100} max={100} step={10} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button data-edit-control disabled={!canEdit || busy} onClick={() => void level([clip.id])}>
          {busy ? "Listening…" : "Level volume"}
        </Button>
        {clip.type === "video" && (
          <Button data-edit-control disabled={!canEdit || clip.volume === 0} onClick={() => separateAudio(store)}>
            Separate audio
          </Button>
        )}
        {clip.type === "audio" && (
          <Button data-edit-control disabled={!canEdit} onClick={() => duckSelection(store)}>
            Duck under speech
          </Button>
        )}
      </div>
      <CleanUp clip={clip} />
    </Section>
  );
}

const ADJUST_FIELDS: { field: keyof typeof ADJUST_RANGE; label: string; suffix: string }[] = [
  { field: "brightness", label: "Brightness", suffix: "%" },
  { field: "contrast", label: "Contrast", suffix: "%" },
  { field: "saturation", label: "Saturation", suffix: "%" },
  { field: "temperature", label: "Warmth", suffix: "%" },
  { field: "hue", label: "Hue", suffix: "°" },
  { field: "vignette", label: "Vignette", suffix: "%" },
  { field: "blur", label: "Blur", suffix: "px" },
];

// A video's or image's colours: ready-made looks, each a set of the numbers below them, and the numbers themselves.
// 0 everywhere is the picture as recorded. Reset takes every one back there, the blur too.
function ColorSection({ clip }: { clip: MediaClip }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const current = lookOf(clip.adjust);
  const reset = () => store.getState().edit([{ op: "update_clip", clipId: clip.id, patch: { adjust: { ...NO_ADJUST } } }], "color change");
  return (
    <Section
      title="Color"
      actions={
        <Button data-edit-control size="sm" disabled={!canEdit || !isAdjusted(clip.adjust)} onClick={reset}>
          Reset color
        </Button>
      }
    >
      <div role="group" aria-label="Looks" className="flex flex-wrap gap-1.5">
        {[{ id: "none", label: "None" }, ...LOOKS].map((look) => (
          <Button
            key={look.id}
            data-edit-control
            size="sm"
            aria-pressed={current === look.id}
            disabled={!canEdit}
            onClick={() => applyLook(store, clip.id, look.id === "none" ? null : look.id)}
          >
            {look.label}
          </Button>
        ))}
      </div>
      {current !== null && current !== "none" && <NumberField clipId={clip.id} field="lookStrength" label="Look strength" suffix="%" min={0} max={100} step={5} />}
      <div className="grid grid-cols-2 gap-2">
        {ADJUST_FIELDS.map(({ field, label, suffix }) => (
          <NumberField key={field} clipId={clip.id} field={field} label={label} suffix={suffix} min={ADJUST_RANGE[field].min} max={ADJUST_RANGE[field].max} />
        ))}
        <NumberField clipId={clip.id} field="rounding" label="Corner rounding" suffix="%" min={0} max={100} />
      </div>
      {/* A green screen: one colour of the picture goes see-through, so what is under the clip shows there. */}
      <Toggle label="Green screen" data-edit-control checked={!!clip.chroma} disabled={!canEdit} onChange={(on) => editField(store, clip.id, "chroma", on ? "on" : "off")} />
      {clip.chroma && (
        <>
          <ColorField clip={clip} canEdit={canEdit} field="chromaColor" label="Color to remove" />
          <div className="grid grid-cols-2 gap-2">
            <NumberField clipId={clip.id} field="chromaTolerance" label="Tolerance" suffix="%" min={0} max={100} />
            <NumberField clipId={clip.id} field="chromaSoftness" label="Edge softness" suffix="%" min={0} max={100} />
          </div>
        </>
      )}
    </Section>
  );
}

// How a clip mixes with what is under it, and for a video or image whether it is mirrored.
function MixSection({ clip }: { clip: Exclude<Clip, { type: "placeholder" }> }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const picture = clip.type === "video" || clip.type === "image";
  return (
    <Section title="Blend">
      <Field label="Blend mode">
        <Select data-edit-control disabled={!canEdit} value={clip.blend ?? "normal"} onChange={(event) => editField(store, clip.id, "blend", event.target.value)}>
          {BLEND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {BLEND_LABEL[mode]}
            </option>
          ))}
        </Select>
      </Field>
      {picture && (
        <div className="grid grid-cols-2 gap-2">
          <Toggle label="Flip sideways" data-edit-control checked={clip.transform.flipH ?? false} disabled={!canEdit} onChange={(on) => editField(store, clip.id, "flipH", on ? "on" : "off")} />
          <Toggle label="Flip upside down" data-edit-control checked={clip.transform.flipV ?? false} disabled={!canEdit} onChange={(on) => editField(store, clip.id, "flipV", on ? "on" : "off")} />
        </div>
      )}
    </Section>
  );
}

// How fast a video or audio clip plays, in percent of as recorded: its length follows, so twice as fast is half as
// long. A video can also be turned round to play backward, and the frame under the playhead held as a freeze frame; a
// clip that does either plays without sound, and a held frame has no speed to set.
function SpeedSection({ clip }: { clip: MediaClip }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const onPlayhead = useEditor((s) => clip.start <= s.playhead && s.playhead < clip.start + clip.duration);
  const held = clip.speed === 0;
  const backward = clip.speed < 0;
  return (
    <Section title="Speed">
      {held ? (
        <Hint>Freeze frame: this clip holds one frame, without sound.</Hint>
      ) : (
        <div className="grid grid-cols-2 items-end gap-2">
          <NumberField clipId={clip.id} field="speed" label="Speed" suffix="%" min={SPEED_PERCENT.min} max={SPEED_PERCENT.max} step={10} />
          <p className={cx(TEXT, "pb-1 text-ed-muted tabular-nums")}>{rateLabel(rateOf(clip))}</p>
        </div>
      )}
      {clip.type === "video" && !held && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button data-edit-control aria-pressed={backward} disabled={!canEdit} onClick={() => reverseSelection(store)}>
              {backward ? "Play forward" : "Reverse"}
            </Button>
            <Button data-edit-control disabled={!canEdit || !onPlayhead} onClick={() => freezeFrame(store)}>
              Freeze frame
            </Button>
          </div>
          {backward && <Hint>Plays backward, without sound.</Hint>}
        </>
      )}
    </Section>
  );
}

// Several clips selected: how many, and for the ones that sound, leveling them all to the same loudness at once.
function ManyClips({ count }: { count: number }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const sounding = useEditor((s) => soundClipsOf(viewDoc(s), s.selection.clipIds).length);
  const { level, busy } = useLevelVolume();
  return (
    <>
      <p className={cx(TEXT, "font-medium text-ed-text")}>{count} clips selected</p>
      <Hint>Select one clip to edit it.</Hint>
      {sounding > 1 && (
        <Section title="Sound">
          <Hint>Make these clips equally loud, or clean up the voice on each.</Hint>
          <div className="flex flex-wrap gap-2">
            <Button data-edit-control disabled={!canEdit || busy} onClick={() => void level(store.getState().selection.clipIds)}>
              {busy ? "Listening…" : "Level volume"}
            </Button>
            <Button data-edit-control disabled={!canEdit} onClick={() => cleanUpSelection(store)}>
              Clean up voice
            </Button>
          </div>
        </Section>
      )}
    </>
  );
}

// What the library knows of a media clip's file. Nothing in it can be changed here.
function MediaSection({ assetId, kind }: { assetId: string; kind: Exclude<Clip["type"], "text"> }) {
  const asset = useLibrary((s) => s.assets[assetId]);
  const loaded = useLibrary((s) => s.loaded);
  let file: string;
  if (asset) file = asset.removed ? PLACEHOLDER_LABELS.removed : asset.name;
  else file = loaded ? PLACEHOLDER_LABELS.unknown : PLACEHOLDER_LABELS.loading;
  const length = kind !== "image" && asset && asset.durationMs !== null ? formatLength(asset.durationMs) : null;

  return (
    <Section title="Media">
      <dl className={cx(TEXT, "grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1")}>
        <dt className={CAPTION}>File</dt>
        <dd className="truncate text-ed-text">{file}</dd>
        {length !== null && (
          <>
            <dt className={CAPTION}>Media length</dt>
            <dd className="text-ed-text tabular-nums">{length}</dd>
          </>
        )}
      </dl>
    </Section>
  );
}

function ClipInspector({ clip }: { clip: Clip }) {
  const canEdit = useEditor((s) => s.canEdit);
  const drawsOnCanvas = clip.type !== "audio" && !(clip.type === "placeholder" && clip.accepts === "audio");
  return (
    <>
      {clip.type === "text" ? (
        <TextSection clip={clip} canEdit={canEdit} />
      ) : clip.type === "placeholder" ? (
        <h2 className="text-sm leading-5 font-semibold text-ed-text">Slot: {clip.slot.name}</h2>
      ) : clip.type === "shape" ? (
        <ShapeSection clip={clip} canEdit={canEdit} />
      ) : (
        <>
          <h2 className="text-sm leading-5 font-semibold text-ed-text">{MEDIA_TITLE[clip.type]}</h2>
          <MediaSection assetId={clip.assetId} kind={clip.type} />
        </>
      )}
      {drawsOnCanvas && <PositionSection clipId={clip.id} lengthLabel={clip.type === "shape" && clip.shape === "arrow" ? `${shapeName(clip)} length` : undefined} />}
      {drawsOnCanvas && clip.type !== "placeholder" && clip.type !== "shape" && <CropSection clipId={clip.id} />}
      {(clip.type === "video" || clip.type === "image") && <ColorSection clip={clip} />}
      {drawsOnCanvas && clip.type !== "placeholder" && clip.type !== "audio" && <MixSection clip={clip} />}
      {(clip.type === "video" || clip.type === "audio") && <SoundSection clip={clip} />}
      {(clip.type === "video" || clip.type === "audio") && <SpeedSection clip={clip} />}
      <TimingSection clipId={clip.id} slips={clip.type === "video" || clip.type === "audio"} />
      <SlotSection clip={clip} />
    </>
  );
}

function clipCount(n: number): string {
  if (n === 0) return "No clips";
  return n === 1 ? "1 clip" : `${n} clips`;
}

function TrackSection({ track }: { track: Track }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const [draft, setDraft] = useState<string | null>(null);

  function saveName() {
    if (draft === null) return;
    setDraft(null);
    renameTrack(store, track.id, draft);
  }

  function onNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      saveName();
    } else if (event.key === "Escape" && draft !== null) {
      event.preventDefault();
      setDraft(null);
    }
  }

  const switches = [
    { field: "locked", label: "Locked" },
    ...trackToggles(track.kind).map((field) => ({ field, label: field === "hidden" ? "Hidden" : "Muted" })),
  ] as const;

  return (
    <Section title="Track">
      <Field label="Name">
        <TextInput
          data-edit-control
          disabled={!canEdit}
          maxLength={LIMITS.trackNameChars}
          value={draft ?? track.name}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={saveName}
          onKeyDown={onNameKeyDown}
        />
      </Field>
      {switches.map(({ field, label }) => (
        <Toggle
          key={field}
          data-edit-control
          disabled={!canEdit}
          label={label}
          checked={track[field]}
          onChange={() => toggleTrack(store, track.id, field)}
        />
      ))}
      {(track.kind === "video" || track.kind === "overlay" || track.kind === "audio") && (
        // How loud the whole track is, on top of each clip's own volume.
        <Field label="Track volume">
          <NumberInput
            ariaLabel="Track volume"
            data-edit-control
            disabled={!canEdit}
            value={Math.round((track.volume ?? 1) * 100)}
            suffix="%"
            min={0}
            max={VOLUME_MAX * 100}
            step={10}
            onCommit={(percent) => {
              const volume = Math.min(VOLUME_MAX, Math.max(0, Math.round(percent) / 100));
              if (volume !== (track.volume ?? 1)) store.getState().edit([{ op: "update_track", trackId: track.id, patch: { volume } }], "track volume");
            }}
          />
        </Field>
      )}
      <p className={cx(TEXT, "text-ed-muted")}>
        {TRACK_KIND_LABEL[track.kind]} · {clipCount(track.clips.length)}
      </p>
      <div className="flex flex-col items-start gap-1">
        <Button
          variant="danger"
          data-edit-control
          disabled={!canEdit || track.locked}
          onClick={() => removeTrack(store, track.id)}
        >
          Remove track
        </Button>
        {track.locked && <Hint>Unlock the track to remove it.</Hint>}
      </div>
    </Section>
  );
}

function ProjectSection() {
  const fps = useEditor((s) => viewDoc(s).fps);
  const length = useEditor((s) => docDuration(viewDoc(s)));

  return (
    <>
      <Section title="Project">
        <FormatFields />
        <p className={cx(TEXT, "text-ed-muted")}>{fps} fps</p>
        <p className={cx(TEXT, "text-ed-muted")}>
          Length <Timecode frame={length} fps={fps} />
        </p>
      </Section>
      <MarkersSection />
      <Hint>Select a clip to edit it.</Hint>
    </>
  );
}

// The project's markers in time order: each one's time, which moves the playhead there, its name to type, and a
// button that removes it. B adds one at the playhead.
function MarkersSection() {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const fps = useEditor((s) => viewDoc(s).fps);
  const doc = useEditor((s) => viewDoc(s));
  const here = useEditor((s) => markerAt(viewDoc(s), s.playhead) !== undefined);
  const markers = sortedMarkers(doc);
  return (
    <Section
      title="Markers"
      actions={
        <Button data-edit-control size="sm" disabled={!canEdit} onClick={() => toggleMarker(store)}>
          {here ? "Remove at playhead" : "Add at playhead"}
        </Button>
      }
    >
      {markers.length === 0 ? (
        <Hint>No markers yet. Press B to mark the playhead&apos;s place.</Hint>
      ) : (
        <ol className="flex flex-col gap-1">
          {markers.map((marker) => (
            <MarkerRow key={marker.id} marker={marker} fps={fps} canEdit={canEdit} />
          ))}
        </ol>
      )}
    </Section>
  );
}

function MarkerRow({ marker, fps, canEdit }: { marker: Marker; fps: number; canEdit: boolean }) {
  const store = useEditorStore();
  const [draft, setDraft] = useState<string | null>(null);
  const time = formatClock(marker.at, fps);
  function save() {
    if (draft !== null && draft !== marker.name) store.getState().edit([{ op: "update_marker", markerId: marker.id, patch: { name: draft } }], "rename marker");
    setDraft(null);
  }
  return (
    <li className="flex min-w-0 items-center gap-2">
      <button type="button" className={cx("w-10 shrink-0 rounded-md text-left font-mono text-xs leading-7 text-ed-muted tabular-nums hover:text-ed-text", FOCUS_RING)} onClick={() => store.getState().seek(marker.at)}>
        {time}
      </button>
      <TextInput
        aria-label={`Marker at ${time}`}
        data-edit-control
        disabled={!canEdit}
        maxLength={LIMITS.markerNameChars}
        placeholder="Marker"
        autoComplete="off"
        value={draft ?? marker.name}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          else if (event.key === "Escape") setDraft(null);
        }}
      />
      <Button data-edit-control size="sm" disabled={!canEdit} aria-label={`Remove the marker at ${time}`} onClick={() => store.getState().edit([{ op: "remove_marker", markerId: marker.id }], "remove marker")}>
        Remove
      </Button>
    </li>
  );
}

// The settings of what is selected: one clip, several clips, a track, or else the project.
export function Inspector() {
  const count = useEditor((s) => s.selection.clipIds.length);
  const clip = useEditor((s) => {
    const ids = s.selection.clipIds;
    return ids.length === 1 ? (findClip(viewDoc(s), ids[0])?.clip ?? null) : null;
  });
  const track = useEditor((s) => {
    const id = s.selection.trackId;
    return id === null ? null : (viewDoc(s).tracks.find((t) => t.id === id) ?? null);
  });

  let body: ReactNode;
  if (clip) body = <ClipInspector key={clip.id} clip={clip} />;
  else if (count > 1) {
    body = <ManyClips count={count} />;
  } else if (track) body = <TrackSection key={track.id} track={track} />;
  else body = <ProjectSection />;

  return <div className="flex flex-col gap-4 p-3">{body}</div>;
}
