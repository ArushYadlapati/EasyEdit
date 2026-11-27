import { fxOf } from "@/lib/render/clip-sound";
import { isGraded } from "@/lib/editor/grade";
import { CROP_PROPS } from "@/lib/timeline/keyframes";
import { STYLE_KEYS, TONE_KEYS, isCropped, isStyled, isToned, lookOf, slotOf, type Clip, type KeyframeProp } from "@/lib/timeline";

// The inspector's sections for one clip: which come first, which are open until a person says otherwise, and the
// open or closed choice a person made, kept in this browser for each kind of clip and section.

export type ClipKind = Clip["type"];
export type SectionId =
  | "text"
  | "shape"
  | "nest"
  | "adjustment"
  | "position"
  | "timing"
  | "speed"
  | "sound"
  | "color"
  | "stylize"
  | "crop"
  | "mask"
  | "blend"
  | "stabilize"
  | "reframe"
  | "follow"
  | "scenes"
  | "background"
  | "slot"
  | "lines";

// What a clip is and when it plays come first, then its sound, then its looks, then the ones used now and then.
// A section a clip does not have is skipped where it is drawn.
export const SECTION_ORDER: Readonly<Record<ClipKind, readonly SectionId[]>> = {
  video: ["position", "timing", "speed", "sound", "color", "stylize", "crop", "mask", "blend", "stabilize", "reframe", "scenes", "slot"],
  audio: ["sound", "timing", "speed", "slot"],
  image: ["position", "timing", "color", "stylize", "crop", "mask", "blend", "background", "follow", "slot"],
  text: ["text", "position", "timing", "blend", "crop", "follow", "slot"],
  shape: ["shape", "position", "timing", "blend", "follow"],
  nest: ["nest", "position", "timing", "color", "stylize", "mask", "blend", "slot"],
  placeholder: ["position", "timing", "slot"],
  adjustment: ["adjustment", "color", "timing", "stylize", "mask"],
  caption: ["lines", "timing"], // a caption clip has its own short inspector: its lines, the captions' style, then Timing
};

// The two or three sections open the first time a kind of clip is selected.
export const OPEN_BY_DEFAULT: Readonly<Record<ClipKind, readonly SectionId[]>> = {
  video: ["position", "timing", "sound"],
  audio: ["sound", "timing"],
  image: ["position", "timing"],
  text: ["text", "position", "timing"],
  shape: ["shape", "position", "timing"],
  nest: ["nest", "position", "timing"],
  placeholder: ["position", "timing", "slot"],
  adjustment: ["adjustment", "color", "timing"],
  caption: ["lines", "timing"],
};

export const FOLDS_KEY = "easyedit-inspector-folds";

export type Folds = Readonly<Record<string, boolean>>;

const foldKey = (kind: ClipKind, id: SectionId) => `${kind}.${id}`;
const FOLD_KEY = /^[a-z]+\.[a-z]+$/;

// The kept text, or anything else: only the "kind.section": true/false pairs are taken.
export function parseFolds(text: string | null | undefined): Folds {
  if (!text) return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const folds: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(data)) if (FOLD_KEY.test(key) && typeof value === "boolean") folds[key] = value;
  return folds;
}

// Whether a section shows its controls: as the person left it, else as the kind of clip opens it.
export function isOpen(folds: Folds, kind: ClipKind, id: SectionId): boolean {
  return folds[foldKey(kind, id)] ?? OPEN_BY_DEFAULT[kind].includes(id);
}

type KeptStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export type FoldStore = {
  get(): Folds;
  set(kind: ClipKind, id: SectionId, open: boolean): void;
  subscribe(listener: () => void): () => void;
};

// storage: this browser's, read again on every get so another tab's choice shows on the next look. A storage that is
// blocked or full keeps the choices for this page only.
export function createFoldStore(storage: () => KeptStorage | null): FoldStore {
  const listeners = new Set<() => void>();
  let text: string | null = null;
  let folds: Folds = {};
  let local: Folds | null = null; // the choices when storage can't keep them
  const read = (): string | null => {
    try {
      return storage()?.getItem(FOLDS_KEY) ?? null;
    } catch {
      return null;
    }
  };
  const get = (): Folds => {
    if (local) return local;
    const now = read();
    if (now !== text) {
      text = now;
      folds = parseFolds(now);
    }
    return folds;
  };
  return {
    get,
    set: (kind, id, open) => {
      const next = { ...get(), [foldKey(kind, id)]: open };
      try {
        const kept = storage();
        if (!kept) throw new Error("no storage");
        kept.setItem(FOLDS_KEY, JSON.stringify(next));
        local = null;
      } catch {
        local = next;
      }
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const keyed = (clip: Clip, props: readonly KeyframeProp[]) =>
  "keyframes" in clip && props.some((prop) => (clip.keyframes?.[prop]?.length ?? 0) > 0);

// What in a section is not as a new clip has it, by the names its fields go by, so a folded section can still say that
// something in it changes the picture or the sound. Place, size and timing are a clip's own and never count; nor do
// the sections that hold only a button.
export function sectionChanges(clip: Clip, id: SectionId): string[] {
  const changes: string[] = [];
  const add = (on: boolean | undefined, name: string) => {
    if (on) changes.push(name);
  };
  const t = clip.transform;
  switch (id) {
    case "position":
      add(t.scale !== 1, "Scale");
      add(t.rotation !== 0, "Rotation");
      add(t.opacity !== 1, "Opacity");
      add(keyed(clip, ["x", "y", "scale", "rotation", "opacity"]), "Keyframes");
      break;
    case "crop":
      add(isCropped(t.crop) || keyed(clip, CROP_PROPS), "Crop");
      break;
    case "color": {
      if (clip.type !== "video" && clip.type !== "image" && clip.type !== "adjustment" && clip.type !== "nest") break;
      // A ready-made look, or colours set by hand (no look matches them).
      const look = lookOf(clip.adjust);
      add(look !== null && look !== "none", "Look");
      add(isToned(clip.adjust) && look === null, "Colors");
      add(keyed(clip, TONE_KEYS), "Keyframes");
      add(isGraded(clip.grade), "Grade");
      add("rounding" in clip && (clip.rounding ?? 0) > 0, "Corner rounding");
      add("chroma" in clip && !!clip.chroma, "Green screen");
      break;
    }
    case "stylize":
      if (clip.type !== "video" && clip.type !== "image" && clip.type !== "adjustment" && clip.type !== "nest") break;
      add(isStyled(clip.adjust) || keyed(clip, STYLE_KEYS), "Effects");
      break;
    case "mask":
      add("mask" in clip && !!clip.mask, "Mask");
      break;
    case "blend":
      add("blend" in clip && (clip.blend ?? "normal") !== "normal", "Blend mode");
      add(t.flipH || t.flipV, "Flip");
      break;
    case "sound":
      if (clip.type !== "video" && clip.type !== "audio") break;
      add(clip.volume !== 1 || keyed(clip, ["volume"]), "Volume");
      add((clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0, "Fades");
      add((clip.pan ?? 0) !== 0, "Pan");
      add(fxOf(clip) !== null, "Clean up");
      break;
    case "speed":
      if (clip.type !== "video" && clip.type !== "audio") break;
      add(clip.speed !== 1, "Speed");
      break;
    case "stabilize":
      add(clip.type === "video" && !!clip.steady, "Stabilized");
      break;
    case "nest":
      add(clip.type === "nest" && (clip.volume ?? 1) !== 1, "Volume");
      break;
    case "slot":
      add(!!slotOf(clip), "Slot");
      break;
  }
  return changes;
}
