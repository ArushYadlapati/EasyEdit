"use client";

import type { ReactNode } from "react";
import { TutorialPlayer } from "@/components/dashboard/tutorial-player";
import type { TutorialVideo } from "@/lib/tutorial/video";

// The tutorial on the Learn page. Someone who has not yet been welcomed with it and plays it here has seen it:
// markSeen is handed over for them only, and writes the mark at the first play. A mark that cannot be written is let
// go; the welcome simply comes as it would have.
export function LearnTutorial({ video, markSeen }: { video: TutorialVideo; markSeen?: () => Promise<unknown> }): ReactNode {
  return <TutorialPlayer video={video} onStarted={markSeen ? () => void markSeen().catch(() => {}) : undefined} />;
}
