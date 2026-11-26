"use client";

import { useEffect, useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { CommentsList } from "./comments-list";
import { useReview } from "./review-context";
import { VersionsList } from "./versions-list";

type View = "comments" | "versions";
const VIEWS: { value: View; label: string }[] = [
  { value: "comments", label: "Comments" },
  { value: "versions", label: "Versions" },
];
const REFRESH_MS = 30_000;

// The Review tab: comments left at moments of the project, and its named versions.
export function ReviewPanel() {
  const review = useReview();
  const [view, setView] = useState<View>("comments");
  const refresh = review?.refresh;

  // While the tab is open the comments are asked for again every half minute, and when the window is come back to.
  useEffect(() => {
    if (!refresh) return;
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  if (!review) return <p className="p-3 text-[13px] leading-5 text-ed-muted">Review isn&apos;t available here.</p>;
  return (
    <div className="flex min-h-full flex-col gap-3 p-3">
      <Segmented<View> label="Review" value={view} options={VIEWS} onChange={setView} className="[&>button]:flex-1" />
      {view === "comments" ? <CommentsList review={review} /> : <VersionsList review={review} />}
    </div>
  );
}
