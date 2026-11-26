"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { TextArea } from "@/components/ui/text-area";
import { Toggle } from "@/components/ui/toggle";
import { formatTimecode } from "@/lib/editor/geometry";
import { REVIEW_LIMITS, threadsOf, type CommentView, type Thread } from "@/lib/review/rules";
import { timeAgo } from "@/lib/time-ago";
import { useEditor, useEditorStore } from "../context";
import type { Review } from "./review-context";

// A small text button: Reply, Resolve, Edit, Delete, and a thread's moment.
export const LINK = cx("rounded-[4px] text-xs font-medium text-ed-muted underline-offset-2 hover:text-ed-text hover:underline", FOCUS_RING);

// A box to write in and its two buttons. Sends on the button or Mod+Enter; onDone closes it (a reply or an edit).
function Writer({ label, start = "", send, sendLabel, onDone }: { label: string; start?: string; send(body: string): Promise<string | null>; sendLabel: string; onDone?(): void }) {
  const [text, setText] = useState(start);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    const failed = await send(text);
    setBusy(false);
    setProblem(failed);
    if (failed === null) {
      setText("");
      onDone?.();
    }
  }
  return (
    <form className="flex flex-col gap-1.5" onSubmit={submit}>
      <TextArea
        aria-label={label}
        placeholder={label}
        rows={2}
        maxLength={REVIEW_LIMITS.commentChars}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
          event.stopPropagation(); // the editor's own keys (Space, J K L…) stay out of a comment
        }}
      />
      {problem && <p role="alert" className="text-xs text-ed-danger">{problem}</p>}
      <div className="flex items-center justify-end gap-2">
        {onDone && (
          <Button type="button" onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
          {sendLabel}
        </Button>
      </div>
    </form>
  );
}

// One comment: who, when, its words, and what this person may do with it.
function Comment({ review, comment, now, children }: { review: Review; comment: CommentView; now: Date; children?: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mine = comment.authorId === review.me;
  const canDelete = mine || review.role === "admin";
  async function remove() {
    const answer = await review.api.deleteComment(comment.id);
    if (answer.ok || answer.gone) return review.drop(comment.id);
    setProblem(answer.message);
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] leading-4 text-ed-muted">
        <span className="font-medium text-ed-text">{comment.author}</span> · {timeAgo(new Date(comment.createdAt), now, "short")}
        {comment.editedAt && " · edited"}
      </p>
      {editing ? (
        <Writer
          label="Edit the comment"
          start={comment.body}
          sendLabel="Save"
          onDone={() => setEditing(false)}
          send={async (body) => {
            const answer = await review.api.updateComment(comment.id, { body });
            if (!answer.ok) return answer.message;
            review.put(answer.comment);
            return null;
          }}
        />
      ) : (
        <p className="text-[13px] leading-5 wrap-break-word whitespace-pre-wrap text-ed-text">{comment.body}</p>
      )}
      {problem && <p role="alert" className="text-xs text-ed-danger">{problem}</p>}
      {!editing && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {children}
          {mine && (
            <button type="button" className={LINK} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {canDelete && (
            <button type="button" className={LINK} aria-label={`Delete the comment by ${comment.author}`} onClick={() => void remove()}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ThreadCard({ review, thread, fps, now }: { review: Review; thread: Thread; fps: number; now: Date }) {
  const store = useEditorStore();
  const [replying, setReplying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { top, replies } = thread;
  const canResolve = top.authorId === review.me || review.role === "editor" || review.role === "admin";
  async function resolve(resolved: boolean) {
    const answer = await review.api.updateComment(top.id, { resolved });
    if (!answer.ok) return setProblem(answer.message);
    setProblem(null);
    review.put(answer.comment);
  }
  return (
    <li className={cx("flex flex-col gap-2 rounded-md border border-ed-line p-2", top.resolved && "opacity-70")} data-comment={top.id}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={cx(LINK, "tabular-nums")} aria-label={`Go to ${formatTimecode(top.frame, fps)}`} onClick={() => store.getState().seek(top.frame)}>
          {formatTimecode(top.frame, fps)}
        </button>
        {top.resolved && <span className="text-[11px] leading-4 text-ed-muted">Resolved</span>}
      </div>
      <Comment review={review} comment={top} now={now}>
        {!replying && (
          <button type="button" className={LINK} onClick={() => setReplying(true)}>
            Reply
          </button>
        )}
        {canResolve && (
          <button type="button" className={LINK} onClick={() => void resolve(!top.resolved)}>
            {top.resolved ? "Reopen" : "Resolve"}
          </button>
        )}
      </Comment>
      {problem && <p role="alert" className="text-xs text-ed-danger">{problem}</p>}
      {replies.length > 0 && (
        <ul role="list" className="flex flex-col gap-2 border-l border-ed-line pl-2">
          {replies.map((reply) => (
            <li key={reply.id}>
              <Comment review={review} comment={reply} now={now} />
            </li>
          ))}
        </ul>
      )}
      {replying && (
        <Writer
          label={`Reply to ${top.author}`}
          sendLabel="Reply"
          onDone={() => setReplying(false)}
          send={async (body) => {
            const answer = await review.api.addComment({ frame: top.frame, body, parentId: top.id });
            if (!answer.ok) return answer.message;
            review.put(answer.comment);
            return null;
          }}
        />
      )}
    </li>
  );
}

// The comments of the project as threads, in timeline order, under a box that writes one at the playhead. Anyone
// who can open the project can comment. Resolved threads are hidden until asked for.
export function CommentsList({ review }: { review: Review }) {
  const fps = useEditor((s) => s.doc.fps);
  const playhead = useEditor((s) => s.playhead);
  const [showResolved, setShowResolved] = useState(false);
  const [now] = useState(() => new Date());
  const threads = threadsOf(review.comments);
  const resolved = threads.filter((t) => t.top.resolved).length;
  const shown = threads.filter((t) => showResolved || !t.top.resolved);

  return (
    <div className="flex flex-col gap-3">
      <Writer
        label={`Comment at ${formatTimecode(playhead, fps)}`}
        sendLabel="Comment"
        send={async (body) => {
          const answer = await review.api.addComment({ frame: playhead, body });
          if (!answer.ok) return answer.message;
          review.put(answer.comment);
          return null;
        }}
      />
      {resolved > 0 && <Toggle label={`Show resolved (${resolved})`} checked={showResolved} onChange={setShowResolved} />}
      {review.load === "loading" && threads.length === 0 ? (
        <p className="text-[13px] leading-5 text-ed-muted">Loading…</p>
      ) : review.load === "failed" ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-[13px] leading-5 text-ed-muted">Couldn&apos;t load the comments.</p>
          <Button onClick={() => void review.refresh()}>Try again</Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-[13px] leading-5 text-ed-muted">{threads.length === 0 ? "No comments yet. Move the playhead to a moment and write one: everyone in this space can." : "Every comment is resolved."}</p>
      ) : (
        <ul role="list" className="flex flex-col gap-2">
          {shown.map((thread) => (
            <ThreadCard key={thread.top.id} review={review} thread={thread} fps={fps} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}
