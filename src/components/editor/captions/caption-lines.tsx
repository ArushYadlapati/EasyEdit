"use client";

import { useMemo, useState } from "react";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { TextInput } from "@/components/ui/text-input";
import { retextOps } from "@/lib/captions/actions";
import { docCues, type Cue } from "@/lib/captions/cues";
import { formatClock } from "@/lib/editor/geometry";
import { useEditor, useEditorStore } from "../context";

// Every caption line in the project in timeline order: its time, which moves the playhead there, and its words, which
// can be retyped to fix them.
export function CaptionLines({ canEdit }: { canEdit: boolean }) {
  const doc = useEditor((s) => s.doc);
  const cues = useMemo(() => docCues(doc), [doc]);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm leading-5 font-semibold text-ed-text">Lines</h2>
      {cues.length === 0 ? (
        <p className="text-[13px] leading-5 text-ed-muted">No captions yet.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {cues.map((cue) => (
            <CaptionLine key={`${cue.clipId}:${cue.words[0].index}`} cue={cue} fps={doc.fps} canEdit={canEdit} />
          ))}
        </ol>
      )}
    </div>
  );
}

// Enter or leaving the box saves the typed words as one edit; Escape puts the line back as it is.
function CaptionLine({ cue, fps, canEdit }: { cue: Cue; fps: number; canEdit: boolean }) {
  const store = useEditorStore();
  const [draft, setDraft] = useState<string | null>(null);
  const time = formatClock(cue.start, fps);

  function save() {
    if (draft === null) return;
    const state = store.getState();
    const ops = retextOps(state.doc, cue, draft);
    if (ops.length > 0) state.edit(ops, "edit caption");
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
        value={draft ?? cue.text}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          else if (event.key === "Escape") setDraft(null);
        }}
      />
    </li>
  );
}
