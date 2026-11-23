"use client";

import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { Segmented } from "@/components/ui/segmented";
import { TextInput } from "@/components/ui/text-input";
import { retextOps } from "@/lib/captions/actions";
import { docCues, type Cue } from "@/lib/captions/cues";
import { fillerRanges, pauseRanges, runCut, wordRanges } from "@/lib/captions/cut";
import { formatClock } from "@/lib/editor/geometry";
import { useEditor, useEditorStore } from "../context";

type Mode = "fix" | "cut";
const pickKey = (clipId: string, index: number) => `${clipId}:${index}`;

// Every caption line in the project in timeline order: its time, which moves the playhead there, and its words. In
// Fix words they can be retyped; in Cut video each word is a button, and the picked words, the long pauses or the
// filler words are cut out of the video itself, closing the gap on the clip's track.
export function CaptionLines({ canEdit }: { canEdit: boolean }) {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const cues = useMemo(() => docCues(doc), [doc]);
  const [mode, setMode] = useState<Mode>("fix");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // Only picks that are still words of a line count: a cut or an undo changes the lines under them.
  const live = useMemo(() => cues.flatMap((cue) => cue.words.filter((w) => picked.has(pickKey(cue.clipId, w.index))).map((w) => ({ clipId: cue.clipId, index: w.index }))), [cues, picked]);
  const genId = () => nanoid(10);
  const selection = () => store.getState().selection.clipIds;

  function toggle(clipId: string, index: number) {
    const key = pickKey(clipId, index);
    setPicked((now) => {
      const next = new Set(now);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  function cutPicked() {
    if (runCut(store, (d) => wordRanges(d, live), genId, "Pick the words to cut first.")) setPicked(new Set());
  }

  return (
    <div className="flex flex-col gap-2">
      {/* The switch sits under the heading, at the panel's full width: beside it, its second name was cut short. */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm leading-5 font-semibold text-ed-text">Lines</h2>
        {cues.length > 0 && (
          <Segmented<Mode>
            label="What the lines do"
            className="w-full"
            value={mode}
            options={[
              { value: "fix", label: "Fix words" },
              { value: "cut", label: "Cut video" },
            ]}
            onChange={setMode}
          />
        )}
      </div>
      {cues.length === 0 ? (
        <p className="text-[13px] leading-5 text-ed-muted">No captions yet.</p>
      ) : mode === "fix" ? (
        <ol className="flex flex-col gap-1">
          {cues.map((cue) => (
            <CaptionLine key={`${cue.clipId}:${cue.words[0].index}`} cue={cue} fps={doc.fps} canEdit={canEdit} />
          ))}
        </ol>
      ) : (
        <>
          <p className="text-[13px] leading-5 text-ed-muted">Pick words to cut them out of the video. What follows on the clip&apos;s track moves up.</p>
          <div className="flex flex-wrap gap-2">
            <Button data-edit-control disabled={!canEdit || live.length === 0} variant="primary" onClick={cutPicked}>
              {live.length === 0 ? "Cut words" : live.length === 1 ? "Cut 1 word" : `Cut ${live.length} words`}
            </Button>
            <Button data-edit-control disabled={!canEdit} onClick={() => runCut(store, (d) => pauseRanges(d, selection()), genId, "No long pauses to cut.", "cut pauses")}>
              Cut pauses
            </Button>
            <Button data-edit-control disabled={!canEdit} onClick={() => runCut(store, (d) => fillerRanges(d, selection()), genId, "No filler words to cut.", "cut filler words")}>
              Cut filler words
            </Button>
          </div>
          <ol className="flex flex-col gap-1.5">
            {cues.map((cue) => (
              <WordLine key={`${cue.clipId}:${cue.words[0].index}`} cue={cue} fps={doc.fps} canEdit={canEdit} picked={picked} onToggle={toggle} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

// One line as words to pick. A picked word is pressed and struck through, as it will be gone from the video.
function WordLine({ cue, fps, canEdit, picked, onToggle }: { cue: Cue; fps: number; canEdit: boolean; picked: ReadonlySet<string>; onToggle(clipId: string, index: number): void }) {
  const store = useEditorStore();
  const time = formatClock(cue.start, fps);
  return (
    <li className="flex min-w-0 items-start gap-2">
      <button
        type="button"
        className={cx("w-10 shrink-0 rounded-md text-left font-mono text-xs leading-7 text-ed-muted tabular-nums hover:text-ed-text", FOCUS_RING)}
        onClick={() => store.getState().seek(cue.start)}
      >
        {time}
      </button>
      <div role="group" aria-label={`Words at ${time}`} className="flex min-w-0 flex-wrap gap-1">
        {cue.words.map((word) => {
          const on = picked.has(pickKey(cue.clipId, word.index));
          return (
            <button
              key={word.index}
              type="button"
              data-edit-control
              disabled={!canEdit}
              aria-pressed={on}
              onClick={() => onToggle(cue.clipId, word.index)}
              className={cx(
                "rounded-md px-1.5 text-[13px] leading-7 disabled:opacity-50",
                on ? "bg-ed-danger/25 text-ed-text line-through" : "bg-ed-raised text-ed-text hover:bg-ed-line-strong",
                FOCUS_RING,
              )}
            >
              {word.text}
            </button>
          );
        })}
      </div>
    </li>
  );
}

// Enter or leaving the box saves the typed words as one edit; Escape puts the line back as it is. The fix is made to
// the words as they were when typing began: if someone changed them meanwhile it can't apply, and says so.
function CaptionLine({ cue, fps, canEdit }: { cue: Cue; fps: number; canEdit: boolean }) {
  const store = useEditorStore();
  const [draft, setDraft] = useState<{ text: string; from: Cue } | null>(null);
  const time = formatClock(cue.start, fps);

  function save() {
    if (draft === null) return;
    const state = store.getState();
    const ops = retextOps(state.doc, draft.from, draft.text);
    if (ops.length > 0) state.edit(ops, "edit caption");
    // Nothing applied, though the text would change the line as it is now: the words moved under the typing.
    else if (retextOps(state.doc, cue, draft.text).length > 0) state.notify("info", "That caption changed while you were typing. Try again.");
    setDraft(null);
  }

  return (
    <li className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        className={cx("w-10 shrink-0 rounded-md text-left font-mono text-xs leading-7 text-ed-muted tabular-nums hover:text-ed-text", FOCUS_RING)}
        onClick={() => store.getState().seek(cue.start)}
      >
        {time}
      </button>
      <TextInput
        aria-label={`Caption at ${time}`}
        data-edit-control
        disabled={!canEdit}
        spellCheck
        autoComplete="off"
        value={draft?.text ?? cue.text}
        onChange={(event) => setDraft({ text: event.target.value, from: draft?.from ?? cue })}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          else if (event.key === "Escape") setDraft(null);
        }}
      />
    </li>
  );
}
