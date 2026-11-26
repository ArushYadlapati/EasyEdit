"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/text-input";
import { cx } from "@/components/ui/cx";
import { linkRefusalMessage, parseVideoLink } from "@/lib/style/links";
import { STYLE_WORDS } from "@/lib/style/messages";

const W = STYLE_WORDS.link;
const TEXT = "text-[13px] leading-5";

export type PasteLinkProps = {
  add(url: string): Promise<string | null>; // why the link wasn't added, or null when it was
  onCancel(): void;
  onUpload(): void; // opens Add a video, for a link that can't be read but whose video can be uploaded
};

// The box a public video link is pasted in, with Add. The link is checked as it's typed: an Instagram link or a TikTok
// share link is told at once why it can't be read, and anything else that isn't a YouTube, Vimeo or TikTok video when
// Add is pressed. The server checks it again and asks the video's site for its title and picture.
export function PasteLink({ add, onCancel, onUpload }: PasteLinkProps): ReactNode {
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fieldId = useId();
  const hintId = useId();
  const problemId = useId();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []); // opened by Paste a link, so typing goes straight in

  const link = text.trim() === "" ? null : parseVideoLink(text);
  // Instagram and share links are told at once; a link of the wrong kind only once Add is pressed, so half a link
  // being typed isn't called wrong.
  const refused = link && !link.ok && (tried || link.reason === "instagram" || link.reason === "tiktok-share") ? link.reason : null;
  const shown = problem ?? (refused ? linkRefusalMessage(refused) : null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (!link || !link.ok || adding) return;
    setAdding(true);
    setProblem(null);
    const stopped = await add(text.trim());
    setAdding(false);
    if (stopped === null) {
      setText("");
      setTried(false);
    } else setProblem(stopped);
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-xs font-medium text-ed-muted">
        {W.label}
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <TextInput
          ref={field}
          id={fieldId}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={W.placeholder}
          value={text}
          aria-invalid={shown ? true : undefined}
          aria-describedby={cx(hintId, shown && problemId)}
          className="min-w-0 flex-1 basis-56"
          onChange={(event) => {
            setText(event.target.value);
            setTried(false);
            setProblem(null);
          }}
        />
        <Button type="submit" disabled={text.trim() === "" || adding}>
          {W.add}
        </Button>
        <Button variant="ghost" disabled={adding} onClick={onCancel}>
          {W.cancel}
        </Button>
      </div>
      {shown && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p id={problemId} role="alert" className={cx(TEXT, "min-w-0 text-ed-danger")}>
            {shown}
          </p>
          {refused === "instagram" && (
            <Button size="sm" onClick={onUpload}>
              {W.uploadInstead}
            </Button>
          )}
        </div>
      )}
      <p id={hintId} className="text-xs leading-4 text-ed-muted">
        {W.hint}
      </p>
    </form>
  );
}
