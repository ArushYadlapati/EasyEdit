import type { ReactNode } from "react";
import { TUTORIAL_SECONDS, TUTORIAL_VOICE_CREDIT } from "@/lib/tutorial/script";
import { clock } from "@/lib/tutorial/timing";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

// The tutorial video's title line, on the Learn page and in the welcome dialog: its name, its length, and inside
// the title itself the credit its voice asks for, when the recording names one (src/lib/tutorial/script.ts).
// It wraps on a narrow screen, so the credit is never cut off.
export function TutorialHeading({ level }: { level: 2 | 3 }): ReactNode {
  const Title = level === 2 ? "h2" : "h3";
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <Title className="text-sm font-semibold">
        {TUTORIAL_WORDS.basics}
        {TUTORIAL_VOICE_CREDIT && (
          <span className="font-normal text-ed-muted">
            {" · "}
            {TUTORIAL_WORDS.voiceBy} {TUTORIAL_VOICE_CREDIT}
          </span>
        )}
      </Title>
      <span className="text-xs text-ed-muted tabular-nums">{clock(TUTORIAL_SECONDS)}</span>
    </div>
  );
}
