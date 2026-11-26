"use client";

import { Plus, WandSparkles, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FADE, FOCUS_RING, TAG, cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { Toggle } from "@/components/ui/toggle";
import { LIMITS } from "@/lib/limits";
import { fillInWaitsFor, profileValueWords } from "@/lib/style/describe";
import { numberText, profilePatch, typedLength, typedShot } from "@/lib/style/draft";
import {
  CAPTION_FIELDS,
  CAPTION_LOOK_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  FORMAT_OPTIONS,
  LOOK_OPTIONS,
  MUSIC_OPTIONS,
  PACE_OPTIONS,
  STYLE_FIELDS,
  STYLE_NOTES_FIELD,
  TEXT_OPTIONS,
  TRANSITION_KIND_OPTIONS,
  TRANSITION_OPTIONS,
  optionFor,
  type StyleOption,
} from "@/lib/style/fields";
import { STYLE_WORDS } from "@/lib/style/messages";
import { mergeSuggestion, suggestStyle } from "@/lib/style/suggest";
import {
  STYLE_LENGTH_SECONDS,
  STYLE_PROFILE_KEYS,
  STYLE_SHOT_SECONDS,
  paceFor,
  type CaptionPosition,
  type Style,
  type StylePatch,
  type StyleProfile,
  type StyleReference,
} from "@/lib/style/types";
import type { CaptionPreset } from "@/lib/timeline";
import { timeAgo } from "@/lib/time-ago";
import { failureWords } from "./style-api";

const W = STYLE_WORDS.form;
const TEXT = "text-[13px] leading-5";
const LABEL = "text-[13px] leading-5 font-medium text-ed-text";
const HELP = "text-xs leading-4 text-ed-muted";
const FILLED = cx(TAG, "border-ed-accent/50 text-ed-accent");
// A box for a sentence that grows with what is typed, from at least 1 or 2 lines (the key), where the browser can size
// a box to its words; elsewhere it is as many rows as it is given. 10 px is the box's padding and edge.
const GROWS = { 1: "[field-sizing:content] min-h-[calc(1lh+10px)]", 2: "[field-sizing:content] min-h-[calc(2lh+10px)]" } as const;
const CHIP = cx(
  "inline-flex h-7 max-w-full items-center rounded-md border border-ed-line bg-ed-raised px-2.5 text-xs font-medium text-ed-muted select-none",
  "enabled:hover:bg-ed-hover enabled:hover:text-ed-text",
  "aria-pressed:border-transparent aria-pressed:bg-ed-accent-weak aria-pressed:text-ed-accent aria-pressed:inset-ring aria-pressed:inset-ring-ed-accent",
  FOCUS_RING,
  FADE,
);

type Key = keyof StyleProfile;
type Note = { tone: "ok" | "info" | "error"; text: string };

// The profile without its two numbers, which the form keeps as the text typed in their boxes.
function withoutNumbers(profile: StyleProfile): StyleProfile {
  const rest = { ...profile };
  delete rest.lengthSeconds;
  delete rest.shotSeconds;
  return rest;
}

const lengthTexts = (profile: StyleProfile) => ({ min: numberText(profile.lengthSeconds?.min), max: numberText(profile.lengthSeconds?.max) });

// One field: its name (with a "Filled in" tag after Fill in from my videos, and Clear once it's set), what it's for,
// then its control. group: the control is several, named by the field's name; otherwise the name labels the control.
function Row({
  label,
  help,
  filled,
  onClear,
  group,
  children,
}: {
  label: string;
  help?: string;
  filled?: boolean;
  onClear?: (() => void) | null;
  group?: boolean;
  children(ids: { control: string; label: string; help: string }): ReactNode;
}) {
  const base = useId();
  const ids = { control: `${base}-control`, label: `${base}-label`, help: `${base}-help` };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-2">
        {group ? (
          <span id={ids.label} className={LABEL}>
            {label}
          </span>
        ) : (
          <label id={ids.label} htmlFor={ids.control} className={LABEL}>
            {label}
          </label>
        )}
        {filled && <span className={FILLED}>{W.filledTag}</span>}
        {onClear && (
          <Button variant="ghost" className="ml-auto" aria-label={W.clearLabel(label)} onClick={onClear}>
            {W.clear}
          </Button>
        )}
      </div>
      {help && (
        <p id={ids.help} className={HELP}>
          {help}
        </p>
      )}
      {children(ids)}
    </div>
  );
}

// Toggle buttons for a field that takes several of a list, in the order they were picked.
function Chips<T extends string>({ labelledBy, describedBy, options, chosen, onChange }: {
  labelledBy: string;
  describedBy: string;
  options: readonly StyleOption<T>[];
  chosen: readonly T[];
  onChange(next: T[]): void;
}) {
  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} className="flex min-w-0 flex-wrap gap-1.5">
      {options.map((option) => {
        const on = chosen.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            className={CHIP}
            onClick={() => onChange(on ? chosen.filter((value) => value !== option.value) : [...chosen, option.value])}
          >
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// One choice out of a few, with what the chosen one means under it. Nothing is chosen while the field isn't set.
function Choice<T extends string>({ label, ids, options, value, onChange }: {
  label: string;
  ids: { help: string };
  options: readonly StyleOption<T>[];
  value: T | undefined;
  onChange(value: T): void;
}) {
  const meaningId = useId();
  const chosen = value === undefined ? undefined : optionFor(options, value);
  return (
    <>
      <Segmented<T | "">
        label={label}
        value={value ?? ""}
        options={options.map((option) => ({ value: option.value, label: option.label }))}
        onChange={(next) => onChange(next as T)}
        aria-describedby={chosen ? `${ids.help} ${meaningId}` : ids.help}
        className="w-full sm:max-w-md"
      />
      {chosen && (
        <p id={meaningId} className={cx(HELP, "text-ed-text")}>
          {chosen.help}
        </p>
      )}
    </>
  );
}

// The Always or Never list: a box for each thing, with remove, and Add for another, up to styleListItems.
function ListRow({ field, items, filled, placeholder, onChange }: { field: "always" | "never"; items: string[]; filled: boolean; placeholder: string; onChange(items: string[]): void }) {
  const { label, help } = STYLE_FIELDS[field];
  const list = useRef<HTMLUListElement>(null);
  const [added, setAdded] = useState(0);
  // A thing just added gets the keyboard, so it can be typed at once.
  useEffect(() => {
    if (added > 0) list.current?.querySelector<HTMLInputElement>("li:last-child input")?.focus();
  }, [added]);
  return (
    <Row label={label} help={help} filled={filled} group>
      {(ids) => (
        <div role="group" aria-labelledby={ids.label} aria-describedby={ids.help} className="flex min-w-0 flex-col gap-1.5">
          {items.length > 0 && (
            <ul ref={list} className="flex min-w-0 flex-col gap-1.5">
              {items.map((item, i) => (
                <li key={i} className="flex min-w-0 items-center gap-1">
                  <TextInput
                    aria-label={W.item(label, i + 1)}
                    value={item}
                    maxLength={LIMITS.styleListItemChars}
                    placeholder={i === 0 ? placeholder : undefined}
                    className="min-w-0 flex-1"
                    onChange={(event) => onChange(items.map((other, j) => (j === i ? event.target.value : other)))}
                  />
                  <IconButton label={W.removeItem(label, i + 1)} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                    <X />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          {items.length < LIMITS.styleListItems ? (
            <Button
              className="self-start"
              aria-label={W.addTo(label)}
              onClick={() => {
                onChange([...items, ""]);
                setAdded((n) => n + 1);
              }}
            >
              <Plus aria-hidden /> {W.add}
            </Button>
          ) : (
            <p className={HELP}>{W.listFull}</p>
          )}
        </div>
      )}
    </Row>
  );
}

// The style as someone who can't change it sees it: each field that is set, in the form's order, then the notes.
function ReadOnly({ style }: { style: Style }) {
  const set = STYLE_PROFILE_KEYS.flatMap((key) => {
    const words = profileValueWords(key, style.profile);
    return words === null ? [] : [{ key, words }];
  });
  if (set.length === 0 && style.notes === "") return <p className={cx(TEXT, "text-ed-muted")}>{W.empty}</p>;
  return (
    <dl className="flex min-w-0 flex-col gap-3">
      {set.map(({ key, words }) => (
        <div key={key} className="flex min-w-0 flex-col gap-0.5">
          <dt className={LABEL}>{STYLE_FIELDS[key].label}</dt>
          {key === "always" || key === "never" ? (
            <dd>
              <ul className={cx(TEXT, "list-disc pl-5 text-ed-text")}>
                {(style.profile[key] ?? []).map((item, i) => (
                  <li key={i} className="break-words">
                    {item}
                  </li>
                ))}
              </ul>
            </dd>
          ) : (
            <dd className={cx(TEXT, "break-words text-ed-text")}>{words}</dd>
          )}
        </div>
      ))}
      {style.notes !== "" && (
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className={LABEL}>{STYLE_NOTES_FIELD.label}</dt>
          <dd className={cx(TEXT, "break-words whitespace-pre-wrap text-ed-text")}>{style.notes}</dd>
        </div>
      )}
    </dl>
  );
}

export type StyleFormProps = {
  spaceId: string;
  canEdit: boolean;
  initial: Style;
  references: readonly StyleReference[]; // what Fill in from my videos reads
  save(spaceId: string, patch: StylePatch): Promise<Style>;
  now?: Date; // when the page was drawn, for "2 hours ago"; a test gives one
  onChanged?(changed: boolean): void; // whether there are changes Save hasn't sent, as that changes
  onSaved?(style: Style): void; // the style as the server saved it
};

// "Your style": every field of the space's style, with the words from fields.ts, and Save, which sends only what
// changed. Fill in from my videos fills the fields still empty from what the references showed, never one the person
// set, and tags each until it's saved; until a reference is ready to read it is switched off, with a line saying why:
// nothing added, a video still to be looked at, or nothing that could be. Who changed the style last, and when, sits
// under the heading (at the right of Fill in on a wide window). Viewers see the fields that are set, with nothing to
// change.
export function StyleForm({ spaceId, canEdit, initial, references, save, now, onChanged, onSaved }: StyleFormProps): ReactNode {
  const headingId = useId();
  const fillHintId = useId();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<StyleProfile>(() => withoutNumbers(initial.profile));
  const [notes, setNotes] = useState(initial.notes);
  const [length, setLength] = useState(() => lengthTexts(initial.profile));
  const [shot, setShot] = useState(() => numberText(initial.profile.shotSeconds));
  const [touched, setTouched] = useState({ length: false, shot: false });
  const [filled, setFilled] = useState<ReadonlySet<Key>>(new Set());
  const [fillNote, setFillNote] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const drawnAt = now ?? new Date();

  // A box still showing what was saved stands for the saved number itself, which may have more places than the box
  // shows or than typedShot keeps (an agent's 1.64), so opening the page never counts as a change.
  const savedLength = lengthTexts(saved.profile);
  const typedLengthNow =
    length.min === savedLength.min && length.max === savedLength.max ? { ok: true as const, value: saved.profile.lengthSeconds } : typedLength(length.min, length.max);
  const typedShotNow = shot === numberText(saved.profile.shotSeconds) ? { ok: true as const, value: saved.profile.shotSeconds } : typedShot(shot);
  const current: StyleProfile = { ...draft };
  if (typedLengthNow.ok && typedLengthNow.value) current.lengthSeconds = typedLengthNow.value;
  if (typedShotNow.ok && typedShotNow.value !== undefined) current.shotSeconds = typedShotNow.value;
  const patch = profilePatch(saved.profile, current);
  const notesChanged = notes.trim() !== saved.notes;
  const changed = Object.keys(patch).length > 0 || notesChanged;
  const blocked = !typedLengthNow.ok || !typedShotNow.ok;
  // A box typed into that doesn't hold a number yet is a change too, which leaving would lose.
  const unsent = changed || length.min !== savedLength.min || length.max !== savedLength.max || shot !== numberText(saved.profile.shotSeconds);
  useEffect(() => {
    onChanged?.(canEdit && unsent);
  }, [canEdit, unsent, onChanged]);

  // A field changed by hand is no longer what Fill in put there, so it loses its tag.
  function untag(key: Key) {
    setFilled((was) => (was.has(key) ? new Set([...was].filter((other) => other !== key)) : was));
  }

  // Sets one field, or takes it off (undefined). Any change clears the line Save left.
  function set<K extends Key>(key: K, value: StyleProfile[K] | undefined) {
    setDraft((was) => {
      const next = { ...was };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    untag(key);
    setNote(null);
  }

  function setCaptions(part: Partial<NonNullable<StyleProfile["captions"]>>) {
    set("captions", { on: false, ...draft.captions, ...part });
  }

  // A pace that a typed shot doesn't fit empties the shot; a shot typed in sets the pace it is.
  function choosePace(pace: NonNullable<StyleProfile["pace"]>) {
    set("pace", pace);
    if (typedShotNow.ok && typedShotNow.value !== undefined && paceFor(typedShotNow.value) !== pace) {
      setShot("");
      untag("shotSeconds");
    }
  }

  function typeShot(text: string) {
    setShot(text);
    untag("shotSeconds");
    setNote(null);
    const typed = typedShot(text);
    if (typed.ok && typed.value !== undefined) set("pace", paceFor(typed.value));
  }

  const analyses = references.flatMap((r) => (r.status === "ready" && r.analysis ? [r.analysis] : []));
  // Why Fill in can't be used yet; null once something is ready.
  const fillHint = fillInWaitsFor(references);

  function fillIn() {
    if (analyses.length === 0) return;
    const merged = mergeSuggestion(current, suggestStyle(analyses));
    // A box being typed in keeps what's typed, even when it isn't a number yet.
    const typing = (key: Key) => (key === "lengthSeconds" && (length.min.trim() !== "" || length.max.trim() !== "")) || (key === "shotSeconds" && shot.trim() !== "");
    const taken = merged.filled.filter((key) => !typing(key));
    setDraft((was) => {
      const next: Record<string, unknown> = { ...was };
      for (const key of taken) if (key !== "lengthSeconds" && key !== "shotSeconds") next[key] = merged.profile[key];
      return next as StyleProfile;
    });
    if (taken.includes("lengthSeconds")) setLength(lengthTexts(merged.profile));
    if (taken.includes("shotSeconds")) setShot(numberText(merged.profile.shotSeconds));
    setFilled((was) => new Set([...was, ...taken]));
    setFillNote(taken.length > 0 ? W.filledSome(taken.length, analyses.map((a) => a.kind)) : W.fillInNothing);
    setNote(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!changed || blocked || saving) return;
    const body: StylePatch = {};
    if (Object.keys(patch).length > 0) body.profile = patch;
    if (notesChanged) body.notes = notes.trim();
    setSaving(true);
    setNote(null);
    try {
      const next = await save(spaceId, body);
      setSaved(next);
      onSaved?.(next);
      setDraft(withoutNumbers(next.profile));
      setNotes(next.notes);
      setLength(lengthTexts(next.profile));
      setShot(numberText(next.profile.shotSeconds));
      setTouched({ length: false, shot: false });
      setFilled(new Set());
      setFillNote(null);
      setNote({ tone: "ok", text: W.saved });
    } catch (error) {
      setNote({ tone: "error", text: failureWords(error) });
    } finally {
      setSaving(false);
    }
  }

  const lastChanged = saved.updatedAt === null ? null : W.lastChanged(saved.updatedByName, timeAgo(new Date(saved.updatedAt), drawnAt));
  const clearer = (key: Key) => (draft[key] === undefined ? null : () => set(key, undefined));
  const captions = draft.captions;
  const look = draft.look === undefined ? undefined : optionFor(LOOK_OPTIONS, draft.look);
  const captionLook = captions?.look === undefined ? undefined : optionFor(CAPTION_LOOK_OPTIONS, captions.look);

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h2 id={headingId} className="text-sm font-semibold text-ed-text">
        {W.heading}
      </h2>
      {(canEdit || lastChanged) && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {canEdit && (
            <Button disabled={fillHint !== null} aria-describedby={fillHint ? fillHintId : undefined} onClick={fillIn}>
              <WandSparkles aria-hidden /> {W.fillIn}
            </Button>
          )}
          {lastChanged && <p className={cx("text-xs text-ed-muted", canEdit && "sm:ml-auto")}>{lastChanged}</p>}
        </div>
      )}
      {canEdit && fillHint && (
        <p id={fillHintId} className={HELP}>
          {fillHint}
        </p>
      )}
      {canEdit && fillNote && (
        <p role="status" className={cx(TEXT, "text-ed-text")}>
          {fillNote}
        </p>
      )}
      {!canEdit ? (
        <ReadOnly style={saved} />
      ) : (
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <Row label={STYLE_FIELDS.summary.label} help={STYLE_FIELDS.summary.help} filled={filled.has("summary")}>
            {(ids) => (
              <TextArea
                id={ids.control}
                aria-describedby={ids.help}
                rows={3}
                className={GROWS[2]}
                maxLength={LIMITS.styleSummaryChars}
                value={draft.summary ?? ""}
                onChange={(event) => set("summary", event.target.value)}
              />
            )}
          </Row>

          <Row label={STYLE_FIELDS.formats.label} help={STYLE_FIELDS.formats.help} filled={filled.has("formats")} group>
            {(ids) => <Chips labelledBy={ids.label} describedBy={ids.help} options={FORMAT_OPTIONS} chosen={draft.formats ?? []} onChange={(next) => set("formats", next)} />}
          </Row>

          <Row label={STYLE_FIELDS.lengthSeconds.label} help={STYLE_FIELDS.lengthSeconds.help} filled={filled.has("lengthSeconds")} group>
            {(ids) => (
              <>
                <div
                  role="group"
                  aria-labelledby={ids.label}
                  aria-describedby={ids.help}
                  className="flex min-w-0 flex-wrap items-center gap-2"
                  onBlur={() => setTouched((was) => ({ ...was, length: true }))}
                >
                  <TextInput
                    aria-label={W.shortest}
                    inputMode="numeric"
                    className="max-w-20"
                    value={length.min}
                    aria-invalid={touched.length && !typedLengthNow.ok ? true : undefined}
                    onChange={(event) => {
                      setLength({ ...length, min: event.target.value });
                      untag("lengthSeconds");
                      setNote(null);
                    }}
                  />
                  <span className={cx(TEXT, "text-ed-muted")}>{W.to}</span>
                  <TextInput
                    aria-label={W.longest}
                    inputMode="numeric"
                    className="max-w-20"
                    value={length.max}
                    aria-invalid={touched.length && !typedLengthNow.ok ? true : undefined}
                    onChange={(event) => {
                      setLength({ ...length, max: event.target.value });
                      untag("lengthSeconds");
                      setNote(null);
                    }}
                  />
                  <span className={cx(TEXT, "text-ed-muted")}>{W.seconds}</span>
                </div>
                {touched.length && !typedLengthNow.ok && (
                  <p role="alert" className={cx(TEXT, "text-ed-danger")}>
                    {W.lengthProblem(STYLE_LENGTH_SECONDS.min, STYLE_LENGTH_SECONDS.max)}
                  </p>
                )}
              </>
            )}
          </Row>

          <Row label={STYLE_FIELDS.pace.label} help={STYLE_FIELDS.pace.help} filled={filled.has("pace")} onClear={clearer("pace")} group>
            {(ids) => <Choice label={STYLE_FIELDS.pace.label} ids={ids} options={PACE_OPTIONS} value={draft.pace} onChange={choosePace} />}
          </Row>

          <Row label={STYLE_FIELDS.shotSeconds.label} help={STYLE_FIELDS.shotSeconds.help} filled={filled.has("shotSeconds")}>
            {(ids) => (
              <>
                <div className="flex min-w-0 items-center gap-2">
                  <TextInput
                    id={ids.control}
                    aria-describedby={ids.help}
                    inputMode="decimal"
                    className="max-w-20"
                    value={shot}
                    aria-invalid={touched.shot && !typedShotNow.ok ? true : undefined}
                    onBlur={() => setTouched((was) => ({ ...was, shot: true }))}
                    onChange={(event) => typeShot(event.target.value)}
                  />
                  <span className={cx(TEXT, "text-ed-muted")}>{W.seconds}</span>
                </div>
                {touched.shot && !typedShotNow.ok && (
                  <p role="alert" className={cx(TEXT, "text-ed-danger")}>
                    {W.shotProblem(STYLE_SHOT_SECONDS.min, STYLE_SHOT_SECONDS.max)}
                  </p>
                )}
              </>
            )}
          </Row>

          <Row label={STYLE_FIELDS.hook.label} help={STYLE_FIELDS.hook.help} filled={filled.has("hook")}>
            {(ids) => (
              <TextArea
                id={ids.control}
                aria-describedby={ids.help}
                rows={2}
                className={GROWS[1]}
                maxLength={LIMITS.styleShortTextChars}
                value={draft.hook ?? ""}
                onChange={(event) => set("hook", event.target.value)}
              />
            )}
          </Row>

          <Row label={STYLE_FIELDS.captions.label} help={STYLE_FIELDS.captions.help} filled={filled.has("captions")} onClear={clearer("captions")} group>
            {(ids) => (
              <div role="group" aria-labelledby={ids.label} aria-describedby={ids.help} className="flex min-w-0 flex-col gap-2">
                <Toggle label={CAPTION_FIELDS.on.label} checked={captions?.on === true} onChange={(on) => setCaptions({ on })} />
                {captions?.on && (
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <Field label={CAPTION_FIELDS.look.label} hint={captionLook?.help ?? CAPTION_FIELDS.look.help}>
                      <Select value={captions.look ?? ""} onChange={(event) => setCaptions({ look: (event.target.value || undefined) as CaptionPreset | undefined })}>
                        <option value="">{W.notSet}</option>
                        {CAPTION_LOOK_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={CAPTION_FIELDS.position.label} hint={CAPTION_FIELDS.position.help}>
                      <Select
                        value={captions.position ?? ""}
                        onChange={(event) => setCaptions({ position: (event.target.value || undefined) as CaptionPosition | undefined })}
                      >
                        <option value="">{W.notSet}</option>
                        {CAPTION_POSITION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Toggle label={CAPTION_FIELDS.uppercase.label} checked={captions.uppercase === true} onChange={(uppercase) => setCaptions({ uppercase })} />
                  </div>
                )}
              </div>
            )}
          </Row>

          <Row label={STYLE_FIELDS.text.label} help={STYLE_FIELDS.text.help} filled={filled.has("text")} onClear={clearer("text")} group>
            {(ids) => <Choice label={STYLE_FIELDS.text.label} ids={ids} options={TEXT_OPTIONS} value={draft.text} onChange={(value) => set("text", value)} />}
          </Row>

          <Row label={STYLE_FIELDS.music.label} help={STYLE_FIELDS.music.help} filled={filled.has("music")} onClear={clearer("music")} group>
            {(ids) => <Choice label={STYLE_FIELDS.music.label} ids={ids} options={MUSIC_OPTIONS} value={draft.music} onChange={(value) => set("music", value)} />}
          </Row>

          <Row label={STYLE_FIELDS.transitions.label} help={STYLE_FIELDS.transitions.help} filled={filled.has("transitions")} onClear={clearer("transitions")} group>
            {(ids) => (
              <Choice label={STYLE_FIELDS.transitions.label} ids={ids} options={TRANSITION_OPTIONS} value={draft.transitions} onChange={(value) => set("transitions", value)} />
            )}
          </Row>

          <Row label={STYLE_FIELDS.transitionKinds.label} help={STYLE_FIELDS.transitionKinds.help} filled={filled.has("transitionKinds")} group>
            {(ids) => (
              <Chips
                labelledBy={ids.label}
                describedBy={ids.help}
                options={TRANSITION_KIND_OPTIONS}
                chosen={draft.transitionKinds ?? []}
                onChange={(next) => set("transitionKinds", next)}
              />
            )}
          </Row>

          <Row label={STYLE_FIELDS.look.label} help={STYLE_FIELDS.look.help} filled={filled.has("look")}>
            {(ids) => (
              <>
                <Select
                  id={ids.control}
                  aria-describedby={ids.help}
                  className="w-full sm:max-w-xs"
                  value={draft.look ?? ""}
                  onChange={(event) => set("look", event.target.value || undefined)}
                >
                  <option value="">{W.notSet}</option>
                  {LOOK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                {look && <p className={cx(HELP, "text-ed-text")}>{look.help}</p>}
              </>
            )}
          </Row>

          <Row label={STYLE_FIELDS.voice.label} help={STYLE_FIELDS.voice.help} filled={filled.has("voice")}>
            {(ids) => (
              <TextArea
                id={ids.control}
                aria-describedby={ids.help}
                rows={2}
                className={GROWS[1]}
                maxLength={LIMITS.styleShortTextChars}
                value={draft.voice ?? ""}
                onChange={(event) => set("voice", event.target.value)}
              />
            )}
          </Row>

          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <ListRow field="always" items={draft.always ?? []} filled={filled.has("always")} placeholder={W.alwaysPlaceholder} onChange={(items) => set("always", items)} />
            <ListRow field="never" items={draft.never ?? []} filled={filled.has("never")} placeholder={W.neverPlaceholder} onChange={(items) => set("never", items)} />
          </div>

          <Row label={STYLE_NOTES_FIELD.label} help={STYLE_NOTES_FIELD.help}>
            {(ids) => (
              <TextArea
                id={ids.control}
                aria-describedby={ids.help}
                rows={4}
                maxLength={LIMITS.styleNotesChars}
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                  setNote(null);
                }}
              />
            )}
          </Row>

          <div className="flex min-w-0 flex-wrap items-center gap-3 border-t border-ed-line pt-4">
            <Button type="submit" variant="primary" disabled={!changed || blocked || saving}>
              {saving ? W.saving : W.save}
            </Button>
            {note && (
              <p role={note.tone === "error" ? "alert" : "status"} className={cx(TEXT, "min-w-0", note.tone === "error" ? "text-ed-danger" : "text-ed-muted")}>
                {note.text}
              </p>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
