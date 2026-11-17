"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { linkButtonClass } from "@/components/ui/button-class";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { LIMITS } from "@/lib/limits";
import { createMediaApi } from "@/lib/media/api";
import { createReadTokens } from "@/lib/media/read-tokens";
import { createDriveTransport } from "@/lib/media/uploader";
import { createMoveApi } from "@/lib/projects/move-api";
import { runMove, type MoveOutcome, type MoveProgress } from "@/lib/projects/move-runner";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import type { MySpace } from "@/lib/spaces/types";
import { storageSettingsPath } from "@/lib/storage/messages";

export type MoveSpaceDialogProps = {
  project: { id: string; name: string };
  fromSpace: MySpace;
  targets: MySpace[]; // the person's other spaces where they can edit
  onClose(): void;
  run?: typeof runMove;
};

type Failure = { message: string; target: MySpace; setup: boolean };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Moves a project to another of the person's spaces. The media is copied from this page, so the tab has to stay open:
// while it runs the dialog cannot be closed, only canceled, and leaving the page asks first. Mounted only while open.
export function MoveSpaceDialog({ project, fromSpace, targets, onClose, run = runMove }: MoveSpaceDialogProps): ReactNode {
  const router = useRouter();
  const name = useId();
  const [choice, setChoice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<MoveProgress | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const abort = useRef<AbortController | null>(null);

  // A tab that is closed mid-copy is asked first; a move left open is resumed by the next try.
  useEffect(() => {
    if (!running) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [running]);

  // Closing the page of the dialog (its card left) cancels what runs.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  async function move() {
    const target = targets.find((one) => one.id === choice);
    if (!target || running) return;
    const controller = new AbortController();
    abort.current = controller;
    setFailure(null);
    setProgress(null);
    setRunning(true);
    let outcome: MoveOutcome;
    try {
      outcome = await run(
        {
          projectId: project.id,
          toSpaceId: target.id,
          fromSpaceId: fromSpace.id,
          signal: controller.signal,
          onProgress: (next) => {
            if (!controller.signal.aborted) setProgress(next);
          },
        },
        {
          api: createMoveApi(),
          tokens: createReadTokens({ api: createMediaApi(fromSpace.id) }),
          transport: createDriveTransport(),
          sleep,
          chunkBytes: LIMITS.mediaChunkBytes,
        },
      );
    } catch {
      outcome = { ok: false, message: "The move stopped. Check your connection and try again." };
    }
    if (!mounted.current) return;
    setRunning(false);
    if (outcome.ok) {
      router.push(spacePath(slugFor(target)));
      onClose();
    } else if (!outcome.canceled) {
      setFailure({ message: outcome.message, target, setup: outcome.code === "NO_STORAGE" && (target.kind === "personal" || target.role === "admin") });
    }
  }

  const failed = failure !== null;

  return (
    <Dialog
      title="Move to…"
      open
      onClose={onClose}
      closeDisabled={running}
      footer={
        <>
          {failure?.setup && (
            <Link href={storageSettingsPath(slugFor(failure.target))} className={linkButtonClass("default", "mr-auto")}>
              Set up storage
            </Link>
          )}
          <Button onClick={() => (running ? abort.current?.abort() : onClose())}>Cancel</Button>
          <Button variant="primary" disabled={running || (!failed && choice === null)} onClick={move}>
            {failed ? "Try again" : "Move"}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-ed-muted">{`Its media is copied to the new space. Keep this tab open until it's done.`}</p>
      <div role="radiogroup" aria-label="Space" className="flex flex-col gap-0.5">
        {targets.map((space) => (
          <label key={space.id} className="flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-ed-text hover:bg-ed-hover">
            <input
              type="radio"
              name={name}
              value={space.id}
              checked={choice === space.id}
              disabled={running}
              onChange={() => {
                setChoice(space.id);
                setFailure(null);
              }}
              className={cx("size-3.5 shrink-0 accent-ed-accent", FOCUS_RING)}
            />
            <span className="truncate">{space.name}</span>
          </label>
        ))}
      </div>
      {running && (
        <div className="mt-3 flex flex-col gap-1.5">
          <p>{progress ? `Copying ${progress.filesDone} of ${progress.filesTotal} files` : "Getting ready…"}</p>
          {progress && progress.bytesTotal > 0 && (
            <div
              role="progressbar"
              aria-label="Copying"
              aria-valuemin={0}
              aria-valuemax={progress.bytesTotal}
              aria-valuenow={progress.bytesDone}
              className="h-1.5 overflow-hidden rounded-full bg-ed-hover"
            >
              <div className="h-full bg-ed-accent" style={{ width: `${Math.min(100, (progress.bytesDone / progress.bytesTotal) * 100)}%` }} />
            </div>
          )}
        </div>
      )}
      {failure && (
        <p role="alert" className="mt-3 text-xs text-ed-danger">
          {failure.message}
        </p>
      )}
    </Dialog>
  );
}
