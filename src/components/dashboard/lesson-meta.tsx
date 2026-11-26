import type { ReactNode } from "react";
import { clock } from "@/lib/tutorial/timing";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

// What goes with a lesson's title, on the Learn page and in the welcome dialog: its length, where it sits in the
// guide when that is given, and the credit its voice asks for, when the recording names one
// (GUIDE_VOICE_CREDIT in src/lib/tutorial/script.ts). It wraps on a narrow screen, so the credit is never cut off.
export function LessonMeta({ seconds, place, credit }: { seconds: number; place?: { number: number; of: number }; credit: string | null }): ReactNode {
  const parts = [clock(seconds), ...(place ? [TUTORIAL_WORDS.lessonOf(place.number, place.of)] : []), ...(credit ? [`${TUTORIAL_WORDS.voiceBy} ${credit}`] : [])];
  return <p className="text-xs leading-5 text-ed-muted tabular-nums">{parts.join(" · ")}</p>;
}
