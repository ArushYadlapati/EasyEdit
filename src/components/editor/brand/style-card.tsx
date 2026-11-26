"use client";

import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { linkButtonClass } from "@/components/ui/button-class";
import { cx } from "@/components/ui/cx";
import { settingsTabPath } from "@/lib/spaces/settings-tabs";
import { fetchStyle } from "@/lib/style/client";
import { profileValueWords } from "@/lib/style/describe";
import { LOOK_OPTIONS, MUSIC_OPTIONS, PACE_OPTIONS, STYLE_FIELDS, STYLE_NOTES_FIELD, TEXT_OPTIONS, TRANSITION_OPTIONS, optionFor, type StyleOption } from "@/lib/style/fields";
import { STYLE_WORDS } from "@/lib/style/messages";
import { STYLE_PROFILE_KEYS, type Style, type StyleProfile } from "@/lib/style/types";
import { useEditor } from "../context";
import { LeaveLink } from "../leave-link";

const WORDS = STYLE_WORDS.card;
const TEXT = "text-[13px] leading-5";

// How many lines the card gives a style with no summary.
const GLANCE_LINES = 2;

// The fields that say most about how to edit, in the order the card picks them when there is no summary; the others
// follow in the Style page's order.
const MOST_USEFUL: readonly (keyof StyleProfile)[] = ["pace", "captions", "look", "music", "hook"];
const GLANCE_ORDER: readonly (keyof StyleProfile)[] = [...MOST_USEFUL, ...STYLE_PROFILE_KEYS.filter((key) => key !== "summary" && !MOST_USEFUL.includes(key))];

// The choices the card names alone ("Pace: Quick"): what each one means is on the Style page.
const CHOICES: Partial<Record<keyof StyleProfile, readonly StyleOption<string>[]>> = {
  pace: PACE_OPTIONS,
  text: TEXT_OPTIONS,
  music: MUSIC_OPTIONS,
  transitions: TRANSITION_OPTIONS,
  look: LOOK_OPTIONS,
};

type Read = { spaceId: string; style: Style };
// last: the style as it was last read while the editor has been open, kept here because the tab is unmounted whenever
// another tab is picked.
type CardSpace = { spaceId: string; slug: string; load: typeof fetchStyle; last: Read | null; remember(read: Read): void };
const StyleCardContext = createContext<CardSpace | null>(null);

function fieldWords(key: keyof StyleProfile, profile: StyleProfile): string | null {
  const options = CHOICES[key];
  const value = profile[key];
  if (options && typeof value === "string" && value !== "") return optionFor(options, value)?.label ?? value;
  return profileValueWords(key, profile);
}

// What the card says of a style: its summary; else the most useful things that are set (pace, captions, look, music
// and how it opens before the rest), then its notes, at most GLANCE_LINES of them, each as "Pace: Quick". Nothing for
// a style nobody has filled in.
function glance(style: Style): string[] {
  const summary = profileValueWords("summary", style.profile);
  if (summary) return [summary];
  const lines: string[] = [];
  for (const key of GLANCE_ORDER) {
    const value = fieldWords(key, style.profile);
    if (value) lines.push(WORDS.field(STYLE_FIELDS[key].label, value));
  }
  const notes = style.notes.trim();
  if (notes) lines.push(WORDS.field(STYLE_NOTES_FIELD.label, notes));
  return lines.slice(0, GLANCE_LINES);
}

// The space whose style the Brand kit tab's Style card shows, and the slug its Style page is found by. With no space or
// no slug there is no card: a personal space's settings can't be opened while personal spaces are closed.
// It keeps the last style the card read, so opening the tab again shows it at once. load reads the style (a test
// passes its own).
export function StyleCardProvider({
  spaceId,
  slug,
  load = fetchStyle,
  children,
}: {
  spaceId: string | null;
  slug: string | null;
  load?: typeof fetchStyle;
  children: ReactNode;
}): ReactNode {
  const [last, remember] = useState<Read | null>(null);
  const value = useMemo(() => (spaceId && slug ? { spaceId, slug, load, last, remember } : null), [spaceId, slug, load, last]);
  return <StyleCardContext value={value}>{children}</StyleCardContext>;
}

// The Style card at the bottom of the Brand kit tab: the space's style at a glance (its summary, else a line or two of
// what's set), or that there's none yet, and a link to the Style page. The style is read once each time the tab opens,
// and not again while it stays open. The first time, there's no card until it has arrived, or at all when it couldn't
// be read: the tab works the same without it. Opened again, the card shows the style as last read while it's read
// again, and keeps it if that read fails. Someone who can't edit the project can only look at the style, so their link
// says so, and isn't there at all while there's no style to look at.
export function StyleCard(): ReactNode {
  const space = useContext(StyleCardContext);
  const canEdit = useEditor((s) => s.canEdit);
  const headingId = useId();
  const spaceId = space?.spaceId;
  const load = space?.load;
  const remember = space?.remember;

  useEffect(() => {
    if (!spaceId || !load || !remember) return;
    let gone = false;
    load(spaceId).then(
      (style) => {
        if (!gone) remember({ spaceId, style });
      },
      () => {}, // quietly: the card shows what it had, or isn't drawn
    );
    return () => {
      gone = true;
    };
  }, [spaceId, load, remember]);

  const read = space?.last;
  if (!space || !read || read.spaceId !== space.spaceId) return null;
  const lines = glance(read.style);
  return (
    <section aria-labelledby={headingId} className="flex flex-col items-start gap-2 rounded-md border border-ed-line p-2">
      <h3 id={headingId} className="text-xs font-semibold text-ed-muted">
        {WORDS.heading}
      </h3>
      {lines.length > 0 ? (
        lines.map((line, i) => (
          <p key={i} className={cx(TEXT, "line-clamp-3 w-full break-words")}>
            {line}
          </p>
        ))
      ) : (
        <p className={cx(TEXT, "text-ed-muted")}>{canEdit ? WORDS.empty : WORDS.emptyViewer}</p>
      )}
      {(canEdit || lines.length > 0) && (
        <LeaveLink href={settingsTabPath(space.slug, "style")} className={linkButtonClass()}>
          {canEdit ? WORDS.edit : WORDS.see}
        </LeaveLink>
      )}
    </section>
  );
}
