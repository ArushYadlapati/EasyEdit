"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DISABLED, FOCUS_RING, cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { STYLE_WORDS } from "@/lib/style/messages";
import { timeAgo } from "@/lib/time-ago";

const W = STYLE_WORDS.projects;
const TEXT = "text-[13px] leading-5";

// One of the space's projects the style may learn from: its id, its name and when it was last changed (an ISO time).
export type StyleProject = { id: string; name: string; updatedAt: string };

export type PickProjectsDialogProps = {
  open: boolean;
  onClose(): void;
  projects: readonly StyleProject[]; // the space's most recent projects, newest first
  inStyle: ReadonlySet<string>; // ids of the projects the style already learns from
  room: number; // how many more references the style has room for
  add(projectIds: string[]): Promise<string | null>; // adds them in order; why it stopped, or null when all went in
  now?: Date;
};

// Ticks some of the space's recent projects for the style to learn from, and adds them. Projects already in the style
// show ticked and can't be changed; no more can be ticked than the style has room for.
export function PickProjectsDialog({ open, onClose, projects, inStyle, room, add, now }: PickProjectsDialogProps): ReactNode {
  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const drawnAt = now ?? new Date();
  // What is ticked and not in the style yet: a project added meanwhile drops out of it.
  const chosen = picked.filter((id) => !inStyle.has(id));
  const full = chosen.length >= room;

  async function submit() {
    setAdding(true);
    setProblem(null);
    const stopped = await add(chosen);
    setAdding(false);
    if (stopped === null) {
      setPicked([]);
      onClose();
    } else setProblem(stopped);
  }

  return (
    <Dialog
      title={W.title}
      open={open}
      onClose={onClose}
      closeDisabled={adding}
      footer={
        <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
          <p className={cx(TEXT, "min-w-0 text-ed-muted")}>{W.room(Math.max(0, room - chosen.length))}</p>
          <Button variant="primary" disabled={chosen.length === 0 || adding} onClick={() => void submit()}>
            {adding ? W.adding : W.add(chosen.length)}
          </Button>
        </div>
      }
    >
      <p className={cx(TEXT, "mb-3 text-ed-muted")}>{W.intro}</p>
      {problem && (
        <p role="alert" className={cx(TEXT, "mb-3 text-ed-danger")}>
          {problem}
        </p>
      )}
      {projects.length === 0 ? (
        <p className={cx(TEXT, "text-ed-muted")}>{W.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-ed-line rounded-md border border-ed-line">
          {projects.map((project) => {
            const already = inStyle.has(project.id);
            const checked = already || chosen.includes(project.id);
            const locked = already || adding || (!checked && full);
            return (
              <li key={project.id}>
                <label className={cx("flex min-w-0 items-center gap-3 px-3 py-2", locked ? "cursor-not-allowed" : "cursor-pointer hover:bg-ed-hover")}>
                  <input
                    type="checkbox"
                    className={cx("size-3.5 shrink-0 accent-ed-accent", FOCUS_RING, DISABLED)}
                    checked={checked}
                    disabled={locked}
                    onChange={(event) => {
                      const on = event.target.checked;
                      setProblem(null);
                      setPicked((ids) => (on ? [...ids, project.id] : ids.filter((id) => id !== project.id)));
                    }}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cx(TEXT, "truncate text-ed-text")}>{project.name}</span>
                    <span className="text-xs text-ed-muted">{already ? W.inStyle : W.edited(timeAgo(new Date(project.updatedAt), drawnAt))}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
