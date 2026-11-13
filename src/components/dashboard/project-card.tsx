"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { BlankFrame } from "@/components/dashboard/blank-frame";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { MoveToFolderDialog } from "@/components/dashboard/move-dialog";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Menu, type MenuItem } from "@/components/ui/menu";
import type { DashboardFolder, DashboardProject } from "@/lib/dashboard/view";
import { LIMITS } from "@/lib/limits";
import type { DashboardActions } from "@/lib/projects/dashboard-actions";
import { formatLabel } from "@/lib/timeline";
import { timeAgo } from "@/lib/time-ago";

export type ProjectCardProps = {
  project: DashboardProject;
  folderName: string | null; // shown under the card, in All projects only
  now: Date;
  canEdit: boolean;
  folders: readonly DashboardFolder[];
  actions: Pick<DashboardActions, "rename" | "duplicate" | "remove" | "move">;
};

const OPEN: MenuItem = { id: "open", label: "Open" };
const VIEWER_ITEMS: MenuItem[] = [OPEN];
const EDITOR_ITEMS: MenuItem[] = [
  OPEN,
  { id: "rename", label: "Rename" },
  { id: "duplicate", label: "Duplicate" },
  { id: "move", label: "Move to folder…" },
  { id: "delete", label: "Delete", danger: true, separatorBefore: true },
];

const LABEL = "Project options";

const withId = (id: string, more: Record<string, string> = {}) => {
  const formData = new FormData();
  formData.set("id", id);
  for (const [key, value] of Object.entries(more)) formData.set(key, value);
  return formData;
};

// A project on the dashboard: a blank frame in its shape and its name, which open it in the editor, then its format,
// who changed it last and when, and its folder. Its ⋯ button and a right-click on it open the same menu: Open for
// everyone, and for editors Rename (in place), Duplicate, Move to folder… and Delete (after asking).
export function ProjectCard({ project, folderName, now, canEdit, folders, actions }: ProjectCardProps): ReactNode {
  const router = useRouter();
  const menu = useContextMenu();
  const box = useRef<HTMLLIElement>(null);
  const [renaming, setRenaming] = useState(false);
  const refocus = useRef(false); // a key ended the rename, so focus goes back to the ⋯ button
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null); // why a rename or duplicate was refused
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const rename = useAction(actions.rename);
  const duplicate = useAction(actions.duplicate);
  const remove = useAction(actions.remove);
  const items = canEdit ? EDITOR_ITEMS : VIEWER_ITEMS;

  // The ⋯ button is found in the card rather than by a ref: a ref given to Menu would replace its own.
  const optionsButton = () => box.current?.querySelector<HTMLButtonElement>("[data-card-options]") ?? null;

  useEffect(() => {
    if (renaming || !refocus.current) return;
    refocus.current = false;
    optionsButton()?.focus();
  }, [renaming]);

  // On the card's own failures: cleared when the next one starts, shown when it is refused.
  const onCard = { onStart: () => setMessage(null), onFailure: setMessage };

  function choose(id: string) {
    if (id === "open") router.push(`/editor/${project.id}`);
    else if (!canEdit) return;
    else if (id === "rename") setRenaming(true);
    else if (id === "duplicate") duplicate.submit(withId(project.id), onCard);
    else if (id === "move") setMoving(true);
    else if (id === "delete") {
      setDeleteError(null);
      setDeleting(true);
    }
  }

  function endRename(value: string | null, byKey: boolean) {
    refocus.current = byKey;
    setRenaming(false);
    if (value === null || value.trim() === project.name) return;
    rename.submit(withId(project.id, { name: value }), onCard);
  }

  // The ⋯ menu's own list has handled a right-click on it. The rename field keeps the browser's own menu, and so do
  // the card's dialogs, which sit inside it.
  function onContextMenu(event: MouseEvent<HTMLLIElement>) {
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest("input, dialog"))) return;
    event.preventDefault();
    menu?.({ ...menuPoint(event), label: LABEL, items, onSelect: choose, returnFocus: optionsButton() });
  }

  const picture = (
    <div className="aspect-video rounded-md border border-ed-line bg-ed-panel p-3 transition-colors duration-120 group-hover:bg-ed-hover motion-reduce:transition-none">
      <BlankFrame width={project.width} height={project.height} />
    </div>
  );

  return (
    <li ref={box} className="min-w-0" onContextMenu={onContextMenu}>
      <div className="flex min-w-0 flex-col gap-2">
        {renaming ? (
          // No link while renaming, so a click in the field does not open the project.
          <div className="flex min-w-0 flex-col gap-2">
            {picture}
            <InlineEdit
              label={`New name for ${project.name}`}
              defaultValue={project.name}
              maxLength={LIMITS.projectNameChars}
              onDone={endRename}
            />
          </div>
        ) : (
          <Link href={`/editor/${project.id}`} className={cx("group flex min-w-0 flex-col gap-2 rounded-md", FOCUS_RING)}>
            {picture}
            <div className="truncate text-sm font-medium text-ed-text">{project.name}</div>
          </Link>
        )}
        <div className="flex min-w-0 items-start gap-1">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs text-ed-muted">
            <span className="truncate">{formatLabel(project)}</span>
            <span className="truncate">{`Changed ${timeAgo(project.updatedAt, now, "short")} by ${project.changedBy}`}</span>
            {folderName !== null && <span className="truncate">{folderName}</span>}
          </div>
          <Menu data-card-options label={LABEL} icon={<Ellipsis />} items={items} onSelect={choose} />
        </div>
        {message && (
          <p role="alert" className="text-xs text-ed-danger">
            {message}
          </p>
        )}
      </div>
      {canEdit && (
        <>
          <MoveToFolderDialog
            open={moving}
            project={project}
            folders={folders}
            action={actions.move}
            onClose={() => setMoving(false)}
          />
          <ConfirmDialog
            title="Delete project"
            question={`Delete "${project.name}"?`}
            confirmLabel="Delete"
            open={deleting}
            pending={remove.pending}
            error={deleteError}
            onConfirm={() =>
              remove.submit(withId(project.id), {
                onStart: () => setDeleteError(null),
                onSuccess: () => setDeleting(false),
                onFailure: setDeleteError,
              })
            }
            onClose={() => setDeleting(false)}
          />
        </>
      )}
    </li>
  );
}
