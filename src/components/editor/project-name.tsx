"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { InlineEdit } from "@/components/ui/inline-edit";
import { renameFromEditor } from "@/lib/editor/project-name";
import { LIMITS } from "@/lib/limits";
import { useEditor, useEditorApi, useEditorStore } from "./context";
import { useIsMac } from "./use-shortcuts";

// The project's name in the top bar. An editor clicks it to rename the project in place; a viewer,
// or anyone on a deleted project, sees it as plain text. Each new renameRequest (a count above 0) starts the rename too,
// as the top bar's search does.
export function ProjectName({ renameRequest = 0 }: { renameRequest?: number } = {}): ReactNode {
  const store = useEditorStore();
  const api = useEditorApi();
  const name = useEditor((s) => s.name);
  const canRename = useEditor((s) => s.canEdit && s.status !== "deleted");
  const [editing, setEditing] = useState(false);
  const isMac = useIsMac();
  const renaming = editing && canRename;
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false); // a key ended the rename, so focus goes back to the name

  // A new request starts the rename, adjusted while rendering as React suggests rather than in an effect.
  const [seenRequest, setSeenRequest] = useState(renameRequest);
  if (renameRequest !== seenRequest) {
    setSeenRequest(renameRequest);
    if (renameRequest > 0) setEditing(true);
  }

  useEffect(() => {
    if (renaming || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [renaming]);

  function onDone(value: string | null, byKey: boolean) {
    refocus.current = byKey;
    if (value !== null) void renameFromEditor(store, api, value);
    setEditing(false);
  }

  if (!canRename) {
    return (
      <h1 title={name} className="min-w-0 truncate pl-1 text-sm font-semibold">
        {name}
      </h1>
    );
  }

  if (renaming) {
    // The field's own box is full width, so this wrapper gives it its width.
    return (
      <div className="w-72 min-w-0">
        <InlineEdit data-edit-control label="Project name" defaultValue={name} maxLength={LIMITS.projectNameChars} onDone={onDone} />
      </div>
    );
  }

  return (
    <h1 className="min-w-0">
      <button
        ref={button}
        type="button"
        title={name}
        onClick={(e) => {
          if (isMac && e.ctrlKey) return; // a right-click on a Mac
          setEditing(true);
        }}
        className={cx(
          "h-7 max-w-full truncate rounded-md px-1.5 text-left text-sm leading-5 font-semibold text-ed-text hover:bg-ed-hover",
          FOCUS_RING,
          FADE,
        )}
      >
        {name}
      </button>
    </h1>
  );
}
