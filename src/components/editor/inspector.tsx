"use client";

import { Link2, Link2Off } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
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
import { applyLook, cleanUpSelection, duckSelection, freezeFrame, toggleMarker, removeTrack, renameTrack, resetCrop, reverseSelection, separateAudio, toggleTrack, rampSelection, nestSelection, unnestSelection, cutToAngle, soundFromAngle } from "@/lib/editor/actions";
import { anglesOf, shownAngle, soundAngle } from "@/lib/editor/multicam";
import { formatClock, trackToggles } from "@/lib/editor/geometry";
import { NO_GRADE, isGraded } from "@/lib/editor/grade";
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
  type ClipField, MASK_RANGE } from "@/lib/editor/inspector-fields";
import { mediaLengthFrames } from "@/lib/editor/media-clips";
import { clipFrame } from "@/lib/editor/keyframe-edit";
import { markerAt, sortedMarkers } from "@/lib/editor/markers";
import type { CutoutStep } from "@/lib/editor/cutout";
import { reframePlan } from "@/lib/editor/reframe";
import { explainOpError } from "@/lib/editor/messages";
import { TRACK_KIND_LABEL } from "@/lib/editor/placement";
import { soundClipsOf } from "@/lib/editor/sound";
import { fxOf } from "@/lib/render/clip-sound";
import { rateLabel, rateOf, RAMPS, type RampId } from "@/lib/editor/speed";
import { findClip, viewDoc, type EditorStore } from "@/lib/editor/store";
import type { Units } from "@/lib/editor/settings";
import { UNIT_DECIMALS, UNIT_SUFFIX, toUnit } from "@/lib/editor/units";
import { LIMITS } from "@/lib/limits";
import type { Cutter } from "@/lib/media/cutout/client";
import { CUTOUT_MODEL_BYTES } from "@/lib/media/cutout/protocol";
import { formatLength } from "@/lib/media/messages";
import { PLACEHOLDER_LABELS } from "@/lib/media/playback";
import { BLEND_LABEL, BLEND_MODES, LOOKS, NO_STYLE, NO_TONE, STYLE_KEYS, TONE_KEYS, VOLUME_MAX, docDuration, isColorClip, isCropped, isMediaClip, isStyled, isToned, lookOf, nestClips, nestLength, nestName, type AdjustmentClip, type Clip, type ColorClip, type KeyframeProp, type Marker, type MediaClip, type NestClip, type OpInput, type ShapeClip, type StyleKey, type TextClip, type Track } from "@/lib/timeline";
import { colorStretchOps, plainStretchOps, stretchLook, toggleStretchOps } from "@/lib/editor/text-spans";
import type { SteadyStrength } from "@/lib/media/steady";
import { SHAPE_COLOR, arrowLook, arrowThrough, shapeName, takesRadius } from "@/lib/timeline/shapes";
import { CROP_PROPS, volumeAt } from "@/lib/timeline/keyframes";
import { hasBackground, hasOutline, hasShadow, textExtras } from "@/lib/timeline/text-style";
import { useEditor, useEditorStore, useSettings, useSettingsStore } from "./context";
import { FontSelect } from "./font-select";
import { FormatFields } from "./format-select";
import { KeyframeButton, KeyframeSteps } from "./keyframe-button";
import { useLibrary, useMedia } from "./media/media-context";
import { SlotSection } from "./slot-section";
import { useTextMeasure } from "./text-measure";
import { EffectColor } from "./effects-section";
import { GradeControls } from "./grade-controls";
import { Scopes } from "./scopes";
import { Timecode } from "./timecode";
import { fieldOps, useFieldGesture, useTextField, type FieldView } from "./use-field-gesture";
import { useLevelVolume } from "./use-level-volume";
import { useFollow } from "./use-follow";
import { useSceneSplit } from "./use-scene-split";
import { useCutout } from "./use-cutout";
import { useReframe } from "./use-reframe";
import { useSteady } from "./use-steady";
import { useSyncSound } from "./use-sync-sound";

const TEXT = "text-[13px] leading-5";
const CAPTION = "text-xs font-medium text-ed-muted";

const MEDIA_TITLE: Record<Exclude<Clip["type"], "text" | "placeholder" | "shape" | "adjustment" | "nest">, string> = {
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
    case "sharpen":
    case "grain":
    case "pixelate":
    case "split":
    case "glitch":
    case "vhs":
    case "lookStrength":
    case "maskX":
    case "maskY":
    case "maskWidth":
    case "maskHeight":
    case "maskFeather":
    case "liftLevel":
    case "gammaLevel":
    case "gainLevel":
    case "lutAmount":
    case "shadowOpacity":
    case "backgroundOpacity":
    case "backgroundPadding":
    case "backgroundRadius":
    case "letterSpacing":
      return { scrub: 1, decimals: 0 };
    case "soundGate":
    case "soundCompress":
    case "soundDenoise":
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
  } else if (field === "rounding" || field === "chromaTolerance" || field === "chromaSoftness" || field === "soundGate" || field === "soundCompress" || field === "soundDenoise") {
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

// Styling some of a text's words: the stretch selected in the Text box above made bold, italic, underlined or another
// colour, while the rest keeps the clip's own look. stretch: what is selected there, null for nothing.
function WordStyles({ clip, canEdit, stretch }: { clip: TextClip; canEdit: boolean; stretch: { from: number; to: number } | null }) {
  const store = useEditorStore();
  const styled = clip.spans?.length ?? 0;
  const look = stretchLook(clip, stretch ?? { from: 0, to: 0 });
  const apply = (ops: OpInput[]) => {
    if (ops.length > 0) store.getState().edit(ops, "text style");
  };
  const off = !canEdit || stretch === null;
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Style the selected words">
      <span className={CAPTION}>Selected words</span>
      <div className="flex flex-wrap items-center gap-1">
        {(["bold", "italic", "underline"] as const).map((what) => (
          <Button key={what} data-edit-control aria-pressed={stretch !== null && look[what]} disabled={off} onClick={() => stretch && apply(toggleStretchOps(clip, stretch, what))}>
            {what === "bold" ? "Bold" : what === "italic" ? "Italic" : "Underline"}
          </Button>
        ))}
        <Button data-edit-control variant="ghost" disabled={!canEdit || styled === 0} onClick={() => apply(plainStretchOps(clip, stretch))}>
          {stretch ? "Plain" : "All plain"}
        </Button>
      </div>
      {stretch !== null && <EffectColor label="Color of the selected words" value={look.color ?? clip.style.color} canEdit={canEdit} onCommit={(color) => apply(colorStretchOps(clip, stretch, color))} />}
      <Hint>
        {stretch !== null
          ? "Changes only the words selected in the box above."
          : styled > 0
            ? `${styled === 1 ? "1 stretch has a look of its own" : `${styled} stretches have a look of their own`}. Select words above to change them.`
            : "Select some of the words above to make just those bold, italic, underlined or another color."}
      </Hint>
    </div>
  );
}

function TextSection({ clip, canEdit }: { clip: Clip; canEdit: boolean }) {
  const store = useEditorStore();
  const text = useTextField(store, clip.id, "text", clipFieldValue(clip, "text", fieldContext(viewDoc(store.getState()), clip)));
  // What is selected in the Text box, kept after the box loses focus to a button below it. It counts only for the
  // clip it was made in and while the box still holds the clip's saved words.
  const [selected, setSelected] = useState<{ clipId: string; from: number; to: number } | null>(null);
  // Read wherever the caret may have moved: a selection made, and one let go of by a click or an arrow key.
  const readSelection = (event: { currentTarget: HTMLTextAreaElement }) => {
    const { selectionStart: from, selectionEnd: to } = event.currentTarget;
    setSelected((now) => (from < to ? (now && now.clipId === clip.id && now.from === from && now.to === to ? now : { clipId: clip.id, from, to }) : null));
  };
  if (clip.type !== "text") return null;
  const stretch = selected && selected.clipId === clip.id && text.value === clip.text && selected.to <= clip.text.length ? { from: selected.from, to: selected.to } : null;
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
          onChange={(event) => {
            // New words: what was selected before no longer names the same ones.
            setSelected(null);
            text.change(event.target.value);
          }}
          onBlur={text.save}
          onKeyDown={(event) => text.onKeyDown(event, true)}
          onSelect={readSelection}
          onKeyUp={readSelection}
          onMouseUp={readSelection}
        />
      </Field>
      <WordStyles clip={clip} canEdit={canEdit} stretch={stretch} />
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
  // Cropped, or with a side keyed: Reset takes both off.
  const cropped = useEditor((s) => {
    const clip = findClip(viewDoc(s), clipId)?.clip;
    return isCropped(clip?.transform.crop) || CROP_PROPS.some((side) => (clip?.keyframes?.[side]?.length ?? 0) > 0);
  });
  const side = { suffix: "%", min: 0, max: 95 };
  const SIDES = [["cropLeft", "Crop left"], ["cropTop", "Crop top"], ["cropRight", "Crop right"], ["cropBottom", "Crop bottom"]] as const;
  return (
    <Section title="Crop">
      <div className="grid grid-cols-2 gap-2">
        {SIDES.map(([field, label]) => (
          <Keyed key={field} clipId={clipId} prop={field}>
            <NumberField clipId={clipId} field={field} label={label} {...side} />
          </Keyed>
        ))}
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

// Stabilize: the camera's shake taken out of a video clip. How strongly, the button, and taking it off again.
function StabilizeSection({ clip }: { clip: MediaClip }) {
  const canEdit = useEditor((s) => s.canEdit);
  const { run, off, busy } = useSteady();
  const [strength, setStrength] = useState<SteadyStrength>("normal");
  return (
    <Section title="Stabilize">
      {clip.steady ? (
        <Hint>{`Stabilized: the picture is moved against the camera's shake, and drawn ${Math.round((clip.steady.zoom - 1) * 100)}% larger so its edges never show.`}</Hint>
      ) : (
        <Hint>Takes a hand-held camera&apos;s shake out. The picture is drawn a little larger to make room.</Hint>
      )}
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="How steady">
          <Select data-edit-control disabled={!canEdit || busy} value={strength} onChange={(event) => setStrength(event.target.value as SteadyStrength)}>
            <option value="light">Light: keeps the camera&apos;s own moves</option>
            <option value="normal">Normal</option>
            <option value="strong">Strong: as if on a tripod</option>
          </Select>
        </Field>
        <Button data-edit-control disabled={!canEdit || busy} onClick={() => void run(clip.id, strength)}>
          {busy ? "Looking at the motion…" : clip.steady ? "Stabilize again" : "Stabilize"}
        </Button>
      </div>
      {clip.steady && (
        <Button data-edit-control variant="ghost" className="self-start" disabled={!canEdit || busy} onClick={() => off(clip.id)}>
          Remove stabilizing
        </Button>
      )}
    </Section>
  );
}

// Reframe: for a video whose shape is not the frame's (a wide shot in an upright project). It fills the frame and
// follows the movement. Not shown for a clip that already has the frame's shape.
function ReframeSection({ clipId, assetId }: { clipId: string; assetId: string }) {
  const canEdit = useEditor((s) => s.canEdit);
  const doc = useEditor(viewDoc);
  const width = useLibrary((s) => s.assets[assetId]?.width ?? null);
  const height = useLibrary((s) => s.assets[assetId]?.height ?? null);
  const { run, busy } = useReframe();
  const plan = reframePlan(doc, clipId, width && height ? { width, height } : null);
  if (!plan.ok && (plan.why === "fits" || plan.why === "no-size" || plan.why === "not-a-video")) return null;
  return (
    <Section title="Reframe">
      <Hint>{`This video is ${width && height && width >= height ? "wider" : "taller"} than the frame. Reframing fills the frame with it and moves it to keep what moves in view. It follows movement, not faces.`}</Hint>
      <Button data-edit-control className="self-start" disabled={!canEdit || busy} onClick={() => void run(clipId)}>
        {busy ? "Looking at the movement…" : "Reframe to follow the action"}
      </Button>
    </Section>
  );
}

// Remove background: the person in a picture is kept and the rest made see-through, so the picture can sit over a
// video. The model runs in this browser; the picture goes nowhere.
function cutoutStatus(step: CutoutStep): string {
  if (step.stage === "reading") return "Reading the picture…";
  if (step.stage === "model") return step.done < step.total ? `Getting the model: ${Math.floor((step.done / step.total) * 100)}% of ${Math.round(CUTOUT_MODEL_BYTES / 1_000_000)} MB` : "Starting the model…";
  if (step.stage === "cutting") return "Cutting out…";
  return "Saving the cut-out…";
}
export function CutoutSection({ clipId, cutter }: { clipId: string; cutter?: Cutter }) {
  const canEdit = useEditor((s) => s.canEdit);
  const { run, cancel, step } = useCutout(cutter);
  return (
    <Section title="Background">
      <Hint>Keeps the person in the picture and makes the rest see-through. It works on people, not on things. The first time, a 26 MB model is fetched; the picture never leaves this browser.</Hint>
      <div className="flex items-center gap-2">
        <Button data-edit-control disabled={!canEdit || step !== null} onClick={() => void run(clipId)}>
          Remove background
        </Button>
        {step !== null && step.stage !== "uploading" && <Button onClick={cancel}>Cancel</Button>}
      </div>
      {step !== null && (
        <p role="status" className="text-[13px] leading-5 text-ed-muted">
          {cutoutStatus(step)}
        </p>
      )}
    </Section>
  );
}

// Follow: a text, a shape or an image kept on something in the video under it.
function FollowSection({ clipId }: { clipId: string }) {
  const canEdit = useEditor((s) => s.canEdit);
  const { run, busy } = useFollow();
  return (
    <Section title="Follow">
      <Hint>Put this where something is in the video under it at the playhead, then press Follow: it gets position keyframes that keep it on that thing.</Hint>
      <Button data-edit-control className="self-start" disabled={!canEdit || busy} onClick={() => void run(clipId)}>
        {busy ? "Following…" : "Follow what is under it"}
      </Button>
    </Section>
  );
}

// A nest: several clips as one. What it holds, how loud it is on top of its clips' own volumes, and taking it apart.
function NestSection({ clip, canEdit }: { clip: NestClip; canEdit: boolean }) {
  const store = useEditorStore();
  const fps = useEditor((s) => s.doc.fps);
  const held = nestClips(clip).length;
  const seconds = (frames: number) => `${(frames / fps).toFixed(1)} s`;
  return (
    <>
      <h2 className="text-sm leading-5 font-semibold text-ed-text">{nestName(clip)}</h2>
      <Section title="Nest">
        <Hint>
          {`${held} ${held === 1 ? "clip" : "clips"} on ${clip.tracks.length} ${clip.tracks.length === 1 ? "track" : "tracks"}, drawn together as one picture. It plays ${seconds(clip.duration)} of the ${seconds(nestLength(clip))} it holds.`}
        </Hint>
        <NumberField clipId={clip.id} field="volume" label="Volume" suffix="%" min={0} max={VOLUME_MAX * 100} step={5} />
        <Button data-edit-control className="self-start" disabled={!canEdit} onClick={() => unnestSelection(store)}>
          Unnest
        </Button>
        <Hint>Unnest puts its clips back on the timeline where they play. What is set on the nest itself goes with it.</Hint>
      </Section>
    </>
  );
}

// Footage that came in already edited: find where it cuts from one shot to the next, and split the clip there.
function ScenesSection({ clipId }: { clipId: string }) {
  const canEdit = useEditor((s) => s.canEdit);
  const { split, busy } = useSceneSplit();
  return (
    <Section title="Scenes">
      <Hint>For a video that is already several shots, such as a download or a recording of a call: split this clip where the shot changes.</Hint>
      <Button data-edit-control className="self-start" disabled={!canEdit || busy} onClick={() => void split(clipId)}>
        {busy ? "Looking for cuts…" : "Split at scene changes"}
      </Button>
    </Section>
  );
}

// A clip's sound clean-up: one button that sets it for a voice, and each part on its own. Noise reduction that turns
// down the steady noise under the sound, a rumble filter, a noise gate that turns the gaps between words down, a
// compressor that brings loud and quiet closer together, and three tone bands. It is heard in the preview and is in
// the export.
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
      <NumberField clipId={clip.id} field="soundDenoise" label="Noise reduction" suffix="%" min={0} max={100} step={5} />
      {(clip.sound?.denoise ?? 0) > 0 && <Hint>Turns down steady noise: hiss, a fan, a hum. Made for a voice; a long held note in music can go with it.</Hint>}
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

const STYLE_FIELDS: { field: StyleKey; label: string; suffix: string }[] = [
  { field: "sharpen", label: "Sharpen", suffix: "%" },
  { field: "grain", label: "Film grain", suffix: "%" },
  { field: "pixelate", label: "Pixelate", suffix: "px" },
];

// The loud effects, folded away under More effects.
const MORE_STYLE_FIELDS: { field: StyleKey; label: string; suffix: string }[] = [
  { field: "split", label: "Color split", suffix: "%" },
  { field: "glitch", label: "Glitch", suffix: "%" },
  { field: "vhs", label: "VHS", suffix: "%" },
];

// A video's or image's colours: a ready-made look, each a set of the numbers below it, the numbers themselves, and
// under a fold the grade (wheels, curves and a look-up table). 0 everywhere is the picture as recorded. Reset takes
// every one back there, the blur and the grade too.
function ColorSection({ clip }: { clip: ColorClip }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const current = lookOf(clip.adjust);
  const graded = isGraded(clip.grade);
  // The grade's controls take a lot of room, so they stay folded away until asked for, or until the picture has one.
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? graded;
  // Scopes read the preview as it is drawn, so they are counted only while someone looks at them.
  const [scopes, setScopes] = useState(false);
  const keyed = TONE_KEYS.filter((key) => (clip.keyframes?.[key]?.length ?? 0) > 0);
  // Back to as recorded for the whole clip: the colours, their keyframes and the grade.
  const reset = () =>
    store.getState().edit(
      [{ op: "update_clip", clipId: clip.id, patch: { adjust: { ...NO_TONE }, ...(graded && { grade: { ...NO_GRADE } }), ...(keyed.length > 0 && { keyframes: Object.fromEntries(keyed.map((key) => [key, []])) }) } }],
      "color change",
    );
  return (
    <Section
      title="Color"
      actions={
        <Button data-edit-control size="sm" disabled={!canEdit || (!isToned(clip.adjust) && !graded && keyed.length === 0)} onClick={reset}>
          Reset color
        </Button>
      }
    >
      {/* First, as a look sets the numbers under it. Custom is there only while the numbers are no look's, so the menu
          always says what the picture has; the strength shows while a look is on. */}
      <div className="grid grid-cols-2 items-end gap-2">
        <Field label="Look">
          <Select
            data-edit-control
            disabled={!canEdit}
            value={current ?? "custom"}
            onChange={(event) => applyLook(store, clip.id, event.target.value === "none" ? null : event.target.value)}
          >
            <option value="none">None</option>
            {LOOKS.map((look) => (
              <option key={look.id} value={look.id}>
                {look.label}
              </option>
            ))}
            {current === null && <option value="custom">Custom</option>}
          </Select>
        </Field>
        {current !== null && current !== "none" && <NumberField clipId={clip.id} field="lookStrength" label="Look strength" suffix="%" min={1} max={100} step={5} />}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {ADJUST_FIELDS.map(({ field, label, suffix }) => (
          <Keyed key={field} clipId={clip.id} prop={field}>
            <NumberField clipId={clip.id} field={field} label={label} suffix={suffix} min={ADJUST_RANGE[field].min} max={ADJUST_RANGE[field].max} />
          </Keyed>
        ))}
        {clip.type !== "adjustment" && <NumberField clipId={clip.id} field="rounding" label="Corner rounding" suffix="%" min={0} max={100} />}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" aria-expanded={shown} onClick={() => setOpen(!shown)}>
          {shown ? "Hide wheels, curves and LUT" : "Wheels, curves and LUT"}
        </Button>
        <Button size="sm" variant="ghost" aria-expanded={scopes} onClick={() => setScopes(!scopes)}>
          {scopes ? "Hide scopes" : "Scopes"}
        </Button>
      </div>
      {scopes && <Scopes />}
      {shown && (
        <GradeControls
          clip={clip}
          canEdit={canEdit}
          number={(field, label, min) => <NumberField clipId={clip.id} field={field} label={label} suffix="%" min={min} max={100} step={5} />}
        />
      )}
      {/* A green screen: one colour of the picture goes see-through, so what is under the clip shows there. */}
      {(clip.type === "video" || clip.type === "image") && (
        <Toggle label="Green screen" data-edit-control checked={!!clip.chroma} disabled={!canEdit} onChange={(on) => editField(store, clip.id, "chroma", on ? "on" : "off")} />
      )}
      {(clip.type === "video" || clip.type === "image") && clip.chroma && (
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

// A mask: the part of the picture that shows, or for an adjustment layer the part of the frame it changes. A box or
// an ellipse, placed and sized in percent of the picture, with a soft edge; inverted it is the part that does not.
function MaskSection({ clip }: { clip: ColorClip }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const number = (field: keyof typeof MASK_RANGE, label: string) => (
    <NumberField clipId={clip.id} field={field} label={label} suffix="%" min={MASK_RANGE[field].min} max={MASK_RANGE[field].max} />
  );
  return (
    <Section title="Mask">
      <Toggle label={clip.type === "adjustment" ? "Change only part of the frame" : "Show only part of the picture"} data-edit-control checked={!!clip.mask} disabled={!canEdit} onChange={(on) => editField(store, clip.id, "mask", on ? "on" : "off")} />
      {clip.mask && (
        <>
          <Segmented
            label="Mask shape"
            data-edit-control
            disabled={!canEdit}
            value={clip.mask.shape}
            options={[
              { value: "ellipse", label: "Ellipse" },
              { value: "rect", label: "Rectangle" },
            ]}
            onChange={(shape) => editField(store, clip.id, "maskShape", shape)}
          />
          <div className="grid grid-cols-2 gap-2">
            {number("maskX", "Mask X")}
            {number("maskY", "Mask Y")}
            {number("maskWidth", "Mask width")}
            {number("maskHeight", "Mask height")}
            {number("maskFeather", "Soft edge")}
          </div>
          <Toggle label="Invert" data-edit-control checked={clip.mask.invert ?? false} disabled={!canEdit} onChange={(on) => editField(store, clip.id, "maskInvert", on ? "on" : "off")} />
        </>
      )}
    </Section>
  );
}

// A video's or image's stylised effects, each as how much of it: 0 is off. They are drawn on the graphics card, after
// the colours, on the picture as it sits in the frame. Sharpen, grain and pixelate are always there; the loud ones wait
// under More effects until asked for, or while this clip has one on or keyframed.
function StylizeSection({ clip }: { clip: ColorClip }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const keyed = STYLE_KEYS.filter((key) => (clip.keyframes?.[key]?.length ?? 0) > 0);
  const more = MORE_STYLE_FIELDS.some(({ field }) => (clip.adjust?.[field] ?? 0) !== 0 || keyed.includes(field));
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? more;
  const reset = () =>
    store.getState().edit([{ op: "update_clip", clipId: clip.id, patch: { adjust: { ...NO_STYLE }, ...(keyed.length > 0 && { keyframes: Object.fromEntries(keyed.map((key) => [key, []])) }) } }], "effect change");
  const fields = (list: typeof STYLE_FIELDS) => (
    <div className="grid grid-cols-2 gap-2">
      {list.map(({ field, label, suffix }) => (
        <Keyed key={field} clipId={clip.id} prop={field}>
          <NumberField clipId={clip.id} field={field} label={label} suffix={suffix} min={ADJUST_RANGE[field].min} max={ADJUST_RANGE[field].max} step={suffix === "%" ? 5 : 1} />
        </Keyed>
      ))}
    </div>
  );
  return (
    <Section
      title="Stylize"
      actions={
        <Button data-edit-control size="sm" disabled={!canEdit || (!isStyled(clip.adjust) && keyed.length === 0)} onClick={reset}>
          Reset effects
        </Button>
      }
    >
      {fields(STYLE_FIELDS)}
      <Button size="sm" variant="ghost" className="self-start" aria-expanded={shown} onClick={() => setOpen(!shown)}>
        {shown ? "Hide more effects" : "More effects"}
      </Button>
      {shown && fields(MORE_STYLE_FIELDS)}
    </Section>
  );
}

// How a clip mixes with what is under it, and for a video or image whether it is mirrored.
function MixSection({ clip }: { clip: Exclude<Clip, { type: "placeholder" | "adjustment" }> }) {
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
// long. A video can also be turned round to play backward, the frame under the playhead held as a freeze frame, and
// its speed ramped; a clip that is turned or held plays without sound, and a held frame has no speed to set. A ramp is
// for pictures, so an audio clip has none here.
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
      {clip.type === "video" && !held && !backward && <SpeedRamp canEdit={canEdit} />}
    </Section>
  );
}

// A speed ramp for the selected clip: pick how its speed changes, then Apply. The clip becomes a row of short linked
// pieces, each at its own speed, and what follows it on the track moves to fit.
function SpeedRamp({ canEdit }: { canEdit: boolean }) {
  const store = useEditorStore();
  const [ramp, setRamp] = useState<RampId>("slow_down");
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="Speed ramp">
          <Select data-edit-control disabled={!canEdit} value={ramp} onChange={(event) => setRamp(event.target.value as RampId)}>
            {RAMPS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button data-edit-control disabled={!canEdit} onClick={() => rampSelection(store, ramp)}>
          Apply ramp
        </Button>
      </div>
      <Hint>{RAMPS.find((r) => r.id === ramp)!.says}</Hint>
    </div>
  );
}

// Multicam: with videos on two or more tracks selected, each track is a camera. A button for each cuts to it at the
// playhead (also while playing), and the sound can be taken from one of them.
function MulticamSection() {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const doc = useEditor(viewDoc);
  const selection = useEditor(useShallow((s) => s.selection.clipIds));
  const playhead = useEditor((s) => s.playhead);
  const angles = anglesOf(doc, selection);
  if (angles.length < 2) return null;
  const showing = shownAngle(doc, angles, playhead);
  const heard = soundAngle(doc, selection, angles);
  return (
    <Section title="Multicam">
      <Hint>Each track is a camera. Line them up first (Sync by sound, below), then cut to a camera at the playhead: it shows until the next cut. This works while playing too.</Hint>
      <div className="flex flex-col gap-1" role="group" aria-label="Cut to a camera">
        {angles.map((angle, i) => (
          <Button key={angle.trackId} data-edit-control className="justify-start" aria-pressed={showing === angle.trackId} disabled={!canEdit} onClick={() => cutToAngle(store, angle.trackId)}>
            {`Cut to ${i + 1}: ${angle.name}`}
          </Button>
        ))}
      </div>
      <Field label="Sound from">
        <Select data-edit-control disabled={!canEdit} value={heard ?? ""} onChange={(event) => event.target.value && soundFromAngle(store, event.target.value)}>
          {heard === null && <option value="">Every camera</option>}
          {angles.map((angle, i) => (
            <option key={angle.trackId} value={angle.trackId}>
              {`${i + 1}: ${angle.name}`}
            </option>
          ))}
        </Select>
      </Field>
    </Section>
  );
}

// Several clips selected: how many, and for the ones that sound, leveling them all to the same loudness at once.
function ManyClips({ count }: { count: number }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const sounding = useEditor((s) => soundClipsOf(viewDoc(s), s.selection.clipIds).length);
  const { level, busy } = useLevelVolume();
  const { sync, busy: syncing } = useSyncSound();
  return (
    <>
      <p className={cx(TEXT, "font-medium text-ed-text")}>{count} clips selected</p>
      <Hint>Select one clip to edit it.</Hint>
      <MulticamSection />
      <Section title="Nest">
        <Hint>Make these clips one, to move, trim, fade and color them as a whole.</Hint>
        <Button data-edit-control className="self-start" disabled={!canEdit} onClick={() => nestSelection(store)}>
          Nest clips
        </Button>
      </Section>
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
          <Hint>Recordings of the same moment, such as a camera and a separate microphone: move them so their sound lines up. The first video stays where it is.</Hint>
          <Button data-edit-control className="self-start" disabled={!canEdit || syncing} onClick={() => void sync(store.getState().selection.clipIds)}>
            {syncing ? "Listening…" : "Sync by sound"}
          </Button>
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

// An adjustment layer: how much of it shows, and the colours, grade and effects it puts on everything under it.
function AdjustmentInspector({ clip }: { clip: AdjustmentClip }) {
  return (
    <>
      <Section title="Adjustment layer">
        <Hint>Changes every clip on the tracks under it, for as long as it lasts. Pick a look or set the colors below.</Hint>
        <Keyed clipId={clip.id} prop="opacity">
          <NumberField clipId={clip.id} field="opacity" label="Amount" suffix="%" min={0} max={100} step={5} />
        </Keyed>
      </Section>
      <ColorSection clip={clip} />
      <StylizeSection clip={clip} />
      <MaskSection clip={clip} />
      <TimingSection clipId={clip.id} slips={false} />
    </>
  );
}

function ClipInspector({ clip }: { clip: Clip }) {
  const canEdit = useEditor((s) => s.canEdit);
  const drawsOnCanvas = clip.type !== "audio" && !(clip.type === "placeholder" && clip.accepts === "audio");
  if (clip.type === "adjustment") return <AdjustmentInspector clip={clip} />;
  return (
    <>
      {clip.type === "text" ? (
        <TextSection clip={clip} canEdit={canEdit} />
      ) : clip.type === "placeholder" ? (
        <h2 className="text-sm leading-5 font-semibold text-ed-text">Slot: {clip.slot.name}</h2>
      ) : clip.type === "shape" ? (
        <ShapeSection clip={clip} canEdit={canEdit} />
      ) : clip.type === "nest" ? (
        <NestSection clip={clip} canEdit={canEdit} />
      ) : (
        <>
          <h2 className="text-sm leading-5 font-semibold text-ed-text">{MEDIA_TITLE[clip.type]}</h2>
          <MediaSection assetId={clip.assetId} kind={clip.type} />
        </>
      )}
      {drawsOnCanvas && <PositionSection clipId={clip.id} lengthLabel={clip.type === "shape" && clip.shape === "arrow" ? `${shapeName(clip)} length` : undefined} />}
      {drawsOnCanvas && clip.type !== "placeholder" && clip.type !== "shape" && clip.type !== "nest" && <CropSection clipId={clip.id} />}
      {isColorClip(clip) && <ColorSection clip={clip} />}
      {isColorClip(clip) && <StylizeSection clip={clip} />}
      {isColorClip(clip) && <MaskSection clip={clip} />}
      {drawsOnCanvas && clip.type !== "placeholder" && clip.type !== "audio" && <MixSection clip={clip} />}
      {(clip.type === "video" || clip.type === "audio") && <SoundSection clip={clip} />}
      {(clip.type === "video" || clip.type === "audio") && <SpeedSection clip={clip} />}
      <TimingSection clipId={clip.id} slips={clip.type === "video" || clip.type === "audio"} />
      {clip.type === "video" && clip.speed !== 0 && <StabilizeSection clip={clip} />}
      {clip.type === "video" && clip.speed > 0 && <ScenesSection clipId={clip.id} />}
      {clip.type === "video" && <ReframeSection clipId={clip.id} assetId={clip.assetId} />}
      {clip.type === "image" && <CutoutSection clipId={clip.id} />}
      {(clip.type === "text" || clip.type === "shape" || clip.type === "image") && <FollowSection clipId={clip.id} />}
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
