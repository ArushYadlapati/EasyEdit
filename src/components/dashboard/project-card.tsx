"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { BlankFrame } from "@/components/dashboard/blank-frame";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { PROJECT_DRAG_TYPE } from "@/components/dashboard/drag";
import { MoveToFolderDialog } from "@/components/dashboard/move-dialog";
import { MoveSpaceDialog } from "@/components/dashboard/move-space-dialog";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { PROJECT_GONE, pictureFits, thumbnailUrl, type DashboardFolder, type DashboardProject } from "@/lib/dashboard/view";
import { LIMITS } from "@/lib/limits";
import type { DashboardActions } from "@/lib/projects/dashboard-actions";
import { editorPath } from "@/lib/spaces/paths";
import type { MySpace } from "@/lib/spaces/types";
import { formatLabel } from "@/lib/timeline";
import { timeAgo } from "@/lib/time-ago";

export type ProjectCardProps = {
  project: DashboardProject;
  folderName: string | null; // shown under the card, in All projects only
  now: Date;
  canEdit: boolean;
  pinned: boolean; // in the space's Pinned list
  folders: readonly DashboardFolder[];
  actions: Pick<DashboardActions, "rename" | "duplicate" | "remove" | "move" | "pin" | "unpin">;
  spaceSlug: string;
  fromSpace?: MySpace; // the space shown, and the spaces the person can move a project to from it (Move to…)
  moveTargets?: readonly MySpace[];
  onGone(message: string): void; // the project was deleted elsewhere, so its card is leaving the page: the dashboard says why
};

const OPEN: MenuItem = { id: "open", label: "Open" };
const VIEWER_ITEMS: MenuItem[] = [OPEN];
// What Delete asks: who loses the project, that it can't be brought back, and that its media stays. (The row is only
// marked deleted, but nothing in the app brings it back.)
function deleteQuestion(name: string, space: MySpace | undefined): string {
  const who = space?.kind === "team" ? ` for everyone in ${space.name}` : "";
  return `Delete "${name}"${who}? You can't undo this. Its media stays in Media.`;
}

// Pin or Unpin, after Move to folder…, as the project is in the space's Pinned list or not.
const editorItems = (pinned: boolean, canMoveToSpace: boolean): MenuItem[] => [
  OPEN,
  { id: "rename", label: "Rename" },
  { id: "duplicate", label: "Duplicate" },
  { id: "move", label: "Move to folder…" },
  ...(canMoveToSpace ? [{ id: "move-space", label: "Move to another space…" }] : []),
  pinned ? { id: "unpin", label: "Unpin" } : { id: "pin", label: "Pin" },
  { id: "delete", label: "Delete", danger: true, separatorBefore: true },
];

const LABEL = "Project options";

const withId = (id: string, more: Record<string, string> = {}) => {
  const formData = new FormData();
  formData.set("id", id);
  for (const [key, value] of Object.entries(more)) formData.set(key, value);
  return formData;
};

// A project on the dashboard: its picture in a frame of its shape (a blank frame until it has one) and its name, which
// open it in the editor, then its format, who changed it last and when, and its folder. Its ⋯ button and a right-click
// on it open the same menu: Open for everyone, and for editors Rename (in place), Duplicate, Move to folder…, Move to another space…, Pin or
// Unpin (the space's Pinned list in the sidebar) and Delete (after asking).
export function ProjectCard({ project, folderName, now, canEdit, pinned, folders, actions, spaceSlug, fromSpace, moveTargets, onGone }: ProjectCardProps): ReactNode {
  const router = useRouter();
  const menu = useContextMenu();
  const box = useRef<HTMLLIElement>(null);
  const [renaming, setRenaming] = useState(false);
  const refocus = useRef(false); // a key ended the rename, so focus goes back to the ⋯ button
  const [moving, setMoving] = useState(false);
  const [movingSpace, setMovingSpace] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null); // why a rename or duplicate was refused
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null); // the picture address that failed to load
  const rename = useAction(actions.rename);
  const duplicate = useAction(actions.duplicate);
  const remove = useAction(actions.remove);
  const pin = useAction(actions.pin);
  const unpin = useAction(actions.unpin);
  // the card's edits wait while one of them runs
  const busy = rename.pending || duplicate.pending || remove.pending || pin.pending || unpin.pending;
  const canMoveToSpace = fromSpace !== undefined && moveTargets !== undefined && moveTargets.length > 0;
  const changed = `Changed ${timeAgo(project.updatedAt, now, "short")} by ${project.changedBy}`;
  const editor = editorItems(pinned, canMoveToSpace);
  const items = !canEdit
    ? VIEWER_ITEMS
    : busy
      ? editor.map((item) => (item.id === "open" ? item : { ...item, disabled: true }))
      : editor;

  // The ⋯ button is found in the card rather than by a ref: a ref given to Menu would replace its own.
  const optionsButton = () => box.current?.querySelector<HTMLButtonElement>("[data-card-options]") ?? null;

  // The ⋯ button takes focus back once the dialog has left the page: while it is open, the rest of the page is inert.
  const refocusAfterMove = useRef(false);
  useEffect(() => {
    if (movingSpace || !refocusAfterMove.current) return;
    refocusAfterMove.current = false;
    optionsButton()?.focus();
  }, [movingSpace]);

  useEffect(() => {
    if (renaming || !refocus.current) return;
    refocus.current = false;
    optionsButton()?.focus();
  }, [renaming]);

  // On the card's own failures: cleared when the next one starts, shown when it is refused.
  const onCard = {
    onStart: () => setMessage(null),
    onFailure: (message: string) => (message === PROJECT_GONE ? onGone(message) : setMessage(message)),
  };

  function choose(id: string) {
    if (id === "open") router.push(editorPath(spaceSlug, project.id));
    else if (!canEdit || busy) return;
    else if (id === "rename") setRenaming(true);
    else if (id === "duplicate") duplicate.submit(withId(project.id), onCard);
    else if (id === "move") setMoving(true);
    else if (id === "move-space") setMovingSpace(true);
    else if (id === "pin") pin.submit(withId(project.id), onCard);
    else if (id === "unpin") unpin.submit(withId(project.id), onCard);
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

  // For editors the card drags into a folder in the sidebar, carrying only its id. Not while it is being renamed or
  // one of its dialogs is open, so text in those can be selected; and a drag that starts inside it (such as selected
  // text) is not the card's.
  const draggable = canEdit && !renaming && !moving && !movingSpace && !deleting;
  function onDragStart(event: DragEvent<HTMLLIElement>) {
    if (!draggable || event.target !== event.currentTarget) return;
    event.dataTransfer.setData(PROJECT_DRAG_TYPE, project.id);
    event.dataTransfer.effectAllowed = "move";
  }

  // The saved picture shows unless its address failed to load or the picture has another shape than the project (it is
  // out of date); a newer version is a new address, so it shows again.
  const url = thumbnailUrl(project);
  const img = useRef<HTMLImageElement>(null);
  // A picture that loaded or failed before the page hydrated fired its event before React listened, so it is asked for
  // again: the browser answers from its cache and fires load or error once more. React does the same for an <img> it
  // creates itself.
  useEffect(() => {
    if (url !== null && img.current) img.current.src = url;
  }, [url]);
  const picture = (
    <div className="aspect-video rounded-md border border-ed-line bg-ed-panel p-3 transition-colors duration-120 group-hover:bg-ed-hover motion-reduce:transition-none">
      <BlankFrame width={project.width} height={project.height}>
        {url !== null && url !== failed && (
          // eslint-disable-next-line @next/next/no-img-element -- a picture behind the sign-in, with its version in the address; next/image's optimizer cannot fetch one.
          <img
            ref={img}
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="size-full object-cover"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (!pictureFits({ width: naturalWidth, height: naturalHeight }, project)) setFailed(url);
            }}
            onError={() => setFailed(url)}
          />
        )}
      </BlankFrame>
    </div>
  );

  return (
    <li
      ref={box}
      className="min-w-0"
      draggable={canEdit ? draggable : undefined}
      onDragStart={onDragStart}
      onContextMenu={onContextMenu}
    >
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
          <Link
            href={editorPath(spaceSlug, project.id)}
            draggable={canEdit ? false : undefined}
            className={cx("group flex min-w-0 flex-col gap-2 rounded-md", FOCUS_RING)}
          >
            {picture}
            <div title={project.name} className="truncate text-sm font-medium text-ed-text">
              {project.name}
            </div>
          </Link>
        )}
        <div className="flex min-w-0 items-start gap-1">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs text-ed-muted">
            <span className="truncate">{formatLabel(project)}</span>
            {/* Cut short on a narrow card ("by Claude (for Maya)"), so the whole line is there on hover. */}
            <span title={changed} className="truncate">
              {changed}
            </span>
            {folderName !== null && (
              <span title={folderName} className="truncate">
                {folderName}
              </span>
            )}
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
            onGone={onGone}
          />
          {canMoveToSpace && movingSpace && (
            <MoveSpaceDialog
              project={project}
              fromSpace={fromSpace}
              targets={[...moveTargets]}
              onClose={() => {
                refocusAfterMove.current = true;
                setMovingSpace(false);
              }}
            />
          )}
          <ConfirmDialog
            title="Delete project"
            question={deleteQuestion(project.name, fromSpace)}
            confirmLabel="Delete"
            open={deleting}
            pending={remove.pending}
            error={deleteError}
            onConfirm={() =>
              remove.submit(withId(project.id), {
                onStart: () => setDeleteError(null),
                onSuccess: () => setDeleting(false),
                onFailure: (message) => (message === PROJECT_GONE ? onGone(message) : setDeleteError(message)),
              })
            }
            onClose={() => setDeleting(false)}
          />
        </>
      )}
    </li>
  );
}
