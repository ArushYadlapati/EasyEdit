"use client";

import { Link2, Link2Off } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DISABLED, FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { NumberInput } from "@/components/ui/number-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { Toggle } from "@/components/ui/toggle";
import { removeTrack, renameTrack, resetCrop, toggleTrack } from "@/lib/editor/actions";
import { trackToggles } from "@/lib/editor/geometry";
import {
  FIELD_LABEL,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  weightOptions,
  clipFieldValue,
  cropScrubRange,
  fieldContext,
  parseNumber,
  scrubBounds,
  type ClipField,
} from "@/lib/editor/inspector-fields";
import { mediaLengthFrames } from "@/lib/editor/media-clips";
import { explainOpError } from "@/lib/editor/messages";
import { TRACK_KIND_LABEL } from "@/lib/editor/placement";
import { findClip, viewDoc, type EditorStore } from "@/lib/editor/store";
import type { Units } from "@/lib/editor/settings";
import { UNIT_DECIMALS, UNIT_SUFFIX, toUnit } from "@/lib/editor/units";
import { LIMITS } from "@/lib/limits";
import { formatLength } from "@/lib/media/messages";
import { PLACEHOLDER_LABELS } from "@/lib/media/playback";
import { docDuration, isCropped, type Clip, type KeyframeProp, type Track } from "@/lib/timeline";
import { FONT_LIST, isListedFont } from "@/lib/brand/fonts";
import { AnimationSection, TransitionsSection } from "./effects-section";
import { useBrand } from "./brand/brand-context";
import { useEditor, useEditorStore, useSettings, useSettingsStore } from "./context";
import { FormatFields } from "./format-select";
import { KenBurnsButton, KeyframeButton, KeyframeSteps } from "./keyframe-button";
import { useLibrary, useMedia } from "./media/media-context";
import { useTextMeasure } from "./text-measure";
import { Timecode } from "./timecode";
import { fieldOps, useFieldGesture, useTextField, type FieldView } from "./use-field-gesture";

const TEXT = "text-[13px] leading-5";
const CAPTION = "text-xs font-medium text-ed-muted";

const MEDIA_TITLE: Record<Exclude<Clip["type"], "text">, string> = {
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
      return { scrub: 1, decimals: 1 };
    case "cropLeft":
    case "cropTop":
    case "cropRight":
    case "cropBottom":
      return { scrub: 0.5, decimals: 1 };
    case "start":
    case "duration":
      return { scrub: 1 / fps, decimals: 2 };
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
    return clip && clip.type !== "text" ? clip.assetId : null;
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
      const lengthFrames = clip && clip.type !== "text" ? mediaLengthFrames(library.getState().assets[clip.assetId], doc.fps) : undefined;
      return scrubBounds(doc, clipId, field, lengthFrames);
    };
  } else if (field === "cropLeft" || field === "cropTop" || field === "cropRight" || field === "cropBottom") {
    scrubRange = () => {
      const clip = findClip(store.getState().doc, clipId)?.clip;
      return clip ? cropScrubRange(clip, field) : { min: -Infinity, max: Infinity };
    };
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

// The native color input previews while the picker moves and saves when it closes.
function ColorField({ clip, canEdit }: { clip: Clip; canEdit: boolean }) {
  const store = useEditorStore();
  const swatch = useRef<HTMLInputElement>(null);
  const shown = clipFieldValue(clip, "color", fieldContext(viewDoc(store.getState()), clip));
  const hex = useTextField(store, clip.id, "color", shown);
  const picked = useFieldGesture(store, clip.id, "color");

  // React's onChange follows the input event, so the closing change event is listened for here,
  // afresh after each render so it sees this render's gesture.
  useEffect(() => {
    const input = swatch.current;
    if (!input) return;
    function onChange() {
      if (!input) return;
      // Previewed again first, so the save never depends on which handler ran first.
      picked.preview(fieldOps(store, clip.id, "color", input.value));
      picked.finish();
    }
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  });

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={CAPTION}>Color</span>
      <div className="flex min-w-0 gap-2">
        <input
          ref={swatch}
          type="color"
          aria-label="Color"
          data-edit-control
          disabled={!canEdit}
          value={HEX.test(shown) ? shown : "#000000"}
          onChange={(event) => {
            // The closing change event is saved by the listener above.
            if (event.nativeEvent.type === "change") return;
            picked.preview(fieldOps(store, clip.id, "color", event.target.value));
          }}
          className={cx(
            "h-7 w-9 shrink-0 cursor-pointer rounded-md border border-ed-line-strong bg-ed-raised p-0.5",
            "[&::-moz-color-swatch]:rounded-[4px] [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0",
            FOCUS_RING_INSET,
            FADE,
            DISABLED,
          )}
        />
        <TextInput
          aria-label="Hex color"
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

const ROLE_LABELS = [["title", "Title"], ["subtitle", "Subtitle"], ["body", "Body"]] as const;

// The clip's font: the space's brand kit fonts first, by the kind of text each is for, then every font there is. A font
// not in the list (an agent may write any name) shows as its own entry, so the menu never claims another font.
function FontField({ clip, canEdit }: { clip: Clip; canEdit: boolean }) {
  const store = useEditorStore();
  const { fonts } = useBrand().kit;
  if (clip.type !== "text") return null;
  const family = clip.style.fontFamily;
  return (
    <Field label="Font">
      <Select data-edit-control disabled={!canEdit} value={family} onChange={(event) => editField(store, clip.id, "fontFamily", event.target.value)}>
        {!isListedFont(family) && <option value={family}>{family}</option>}
        <optgroup label="Brand kit">
          {ROLE_LABELS.map(([role, label]) => (
            // The same font may be in both groups; a select shows the first option with the value it is given.
            <option key={role} value={fonts[role]}>{`${label} · ${fonts[role]}`}</option>
          ))}
        </optgroup>
        <optgroup label="All fonts">
          {FONT_LIST.map((f) => (
            <option key={f.family} value={f.family}>
              {f.family}
            </option>
          ))}
        </optgroup>
      </Select>
    </Field>
  );
}

function TextSection({ clip, canEdit }: { clip: Clip; canEdit: boolean }) {
  const store = useEditorStore();
  const text = useTextField(store, clip.id, "text", clipFieldValue(clip, "text", fieldContext(viewDoc(store.getState()), clip)));
  if (clip.type !== "text") return null;
  const weight = clip.style.fontWeight;
  const weights = weightOptions(clip.style.fontFamily, weight);

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
function PositionSection({ clipId, image }: { clipId: string; image: boolean }) {
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
      {image && (
        <div className="flex flex-col items-start">
          <KenBurnsButton clipId={clipId} />
        </div>
      )}
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

function TimingSection({ clipId }: { clipId: string }) {
  return (
    <Section title="Timing">
      <div className="grid grid-cols-2 gap-2">
        <NumberField clipId={clipId} field="start" label="Start" suffix="s" min={0} step={0.1} />
        <NumberField clipId={clipId} field="duration" label="Length" suffix="s" min={0} step={0.1} />
      </div>
    </Section>
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
  return (
    <>
      {clip.type === "text" ? (
        <TextSection clip={clip} canEdit={canEdit} />
      ) : (
        <>
          <h2 className="text-sm leading-5 font-semibold text-ed-text">{MEDIA_TITLE[clip.type]}</h2>
          <MediaSection assetId={clip.assetId} kind={clip.type} />
        </>
      )}
      {clip.type !== "audio" && <PositionSection clipId={clip.id} image={clip.type === "image"} />}
      {clip.type !== "audio" && <CropSection clipId={clip.id} />}
      {(clip.type === "video" || clip.type === "image") && <TransitionsSection clip={clip} />}
      {clip.type === "text" && <AnimationSection clip={clip} />}
      <TimingSection clipId={clip.id} />
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
      <Hint>Select a clip to edit it.</Hint>
    </>
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
    body = (
      <>
        <p className={cx(TEXT, "font-medium text-ed-text")}>{count} clips selected</p>
        <Hint>Select one clip to edit it.</Hint>
      </>
    );
  } else if (track) body = <TrackSection key={track.id} track={track} />;
  else body = <ProjectSection />;

  return <div className="flex flex-col gap-4 p-3">{body}</div>;
}
