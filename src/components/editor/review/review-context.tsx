"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReviewApi, Role } from "@/lib/review/client";
import type { CommentView } from "@/lib/review/rules";

// Review for one open project: its comments (the Review tab lists them, the ruler pins them) and the calls for
// comments and named versions. Without a provider (tests of other parts of the editor) there is no review.

type Load = "loading" | "ready" | "failed";
export type Review = {
  api: ReviewApi;
  comments: CommentView[];
  me: string | null; // the signed-in person's id, as the server names them
  role: Role | null;
  load: Load;
  refresh(): Promise<void>;
  // After a call that changed one comment: put it in the list (or take it out) without asking for the whole list.
  put(comment: CommentView): void;
  drop(commentId: string): void;
  projectHref(projectId: string): string; // a project's editor address in this space
};

const ReviewContext = createContext<Review | null>(null);

export function ReviewProvider({ api, projectHref, children }: { api: ReviewApi; projectHref(projectId: string): string; children: ReactNode }) {
  const [comments, setComments] = useState<CommentView[]>([]);
  const [who, setWho] = useState<{ me: string | null; role: Role | null }>({ me: null, role: null });
  const [load, setLoad] = useState<Load>("loading");
  const asked = useRef(0);

  // Asks for the comments and shows the answer, unless a later ask is on its way. A failed ask keeps what is shown.
  const refresh = useCallback(() => {
    const mine = ++asked.current;
    return api.comments().then((answer) => {
      if (mine !== asked.current) return;
      if (!answer.ok) return setLoad((before) => (before === "ready" ? "ready" : "failed"));
      setComments(answer.comments);
      setWho({ me: answer.me, role: answer.role });
      setLoad("ready");
    });
  }, [api]);

  // Once when the editor opens, so the ruler has its pins. The Review tab keeps it fresh while it is open.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<Review>(
    () => ({
      api,
      comments,
      me: who.me,
      role: who.role,
      load,
      refresh,
      put: (comment) => setComments((all) => (all.some((c) => c.id === comment.id) ? all.map((c) => (c.id === comment.id ? comment : c)) : [...all, comment])),
      drop: (commentId) => setComments((all) => all.filter((c) => c.id !== commentId && c.parentId !== commentId)),
      projectHref,
    }),
    [api, comments, who, load, refresh, projectHref],
  );
  return <ReviewContext value={value}>{children}</ReviewContext>;
}

export function useReview(): Review | null {
  return useContext(ReviewContext);
}
