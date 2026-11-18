"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { Toggle } from "@/components/ui/toggle";
import { formatBytes } from "@/lib/export/facts";
import { frameCount } from "@/lib/export/schedule";
import { SOCIAL_MESSAGES } from "@/lib/social/messages";
import type { PostingStatus } from "@/lib/social/posts";
import { defaultTitle, isVisibility, postFormProblem, showsAsShort, VISIBILITIES, VISIBILITY_LABELS, type PostForm } from "@/lib/social/rules";
import { useEditorStore, useExportDeps } from "../context";
import type { Exporter } from "./use-export";

// Posting a finished export to the space's YouTube channel, inside the Export dialog: the offer on the "done" screen,
// the form, the upload's progress and its end. Nothing is posted until the person presses Post; closing the dialog
// never stops an upload, and opening it again shows where it stands.

type Channel = Extract<PostingStatus, { available: true }>;

type Step =
  | { at: "closed" }
  | { at: "form"; error: string | null }
  | { at: "uploading"; sentBytes: number; totalBytes: number }
  | { at: "posted"; url: string | null; visibility: PostForm["visibility"] };

export type PostPanel = {
  status: Channel | null; // null: nothing to offer (no posting here, or not known yet)
  step: Step;
  form: PostForm;
  short: boolean; // the video will show as a Short
  setForm(change: Partial<PostForm>): void;
  open(): void; // from the "done" screen to the form
  back(): void; // from the form to the "done" screen
  submit(): void; // Post: the person's go-ahead
  cancel(): void; // stops an upload
  close(): void; // forgets everything, as the export is reset
};

const MUTED = "text-ed-muted";
const CLOSED: Step = { at: "closed" };

// One post at a time, owned by the Export dialog. The channel is asked about whenever a finished export is on
// screen: when the export ends, each time the dialog opens, and when the window comes back (an admin may have just
// connected a channel in another tab).
export function usePostPanel(exporter: Exporter, open: boolean): PostPanel {
  const posting = useExportDeps().posting;
  const editor = useEditorStore();
  const done = useStore(exporter.store, (s) => s.phase === "done");
  const [asked, setAsked] = useState<PostingStatus | null>(null);
  const [step, setStep] = useState<Step>(CLOSED);
  const [form, setFormState] = useState<PostForm>({ title: "", description: "", visibility: "private", madeForKids: false });
  const [short, setShort] = useState(false);
  const running = useRef<{ mounted: boolean; controller: AbortController | null; busy: boolean }>({ mounted: false, controller: null, busy: false });

  // Leaving the editor stops an upload; the client then tells the server the post is over.
  useEffect(() => {
    const now = running.current;
    now.mounted = true;
    return () => {
      now.mounted = false;
      now.controller?.abort();
    };
  }, []);

  useEffect(() => {
    if (!posting || !done || !open) return;
    let current = true;
    const ask = () => {
      void posting.status(editor.getState().projectId).then((answer) => {
        if (current) setAsked(answer);
      });
    };
    ask();
    window.addEventListener("focus", ask);
    return () => {
      current = false;
      window.removeEventListener("focus", ask);
    };
  }, [posting, done, open, editor]);

  const status = done && asked?.available ? asked : null;

  return useMemo<PostPanel>(() => {
    const submit = () => {
      const now = running.current;
      if (!posting || now.busy) return;
      const problem = postFormProblem(form);
      if (problem) return setStep({ at: "form", error: problem });
      now.busy = true;
      void (async () => {
        try {
          const file = await exporter.file();
          if (!now.mounted) return;
          if (!file || file.size === 0) return setStep({ at: "form", error: SOCIAL_MESSAGES.cantRead });
          const controller = new AbortController();
          now.controller = controller;
          setStep({ at: "uploading", sentBytes: 0, totalBytes: file.size });
          const outcome = await posting.post({
            projectId: editor.getState().projectId,
            form,
            file,
            signal: controller.signal,
            onProgress: (sentBytes) => {
              if (now.mounted) setStep({ at: "uploading", sentBytes, totalBytes: file.size });
            },
          });
          now.controller = null;
          if (!now.mounted) return;
          if (outcome.status === "posted") setStep({ at: "posted", url: outcome.url, visibility: form.visibility });
          else setStep({ at: "form", error: outcome.status === "failed" ? outcome.message : null });
        } finally {
          now.busy = false;
        }
      })();
    };
    return {
      status,
      step,
      form,
      short,
      setForm: (change) => setFormState((was) => ({ ...was, ...change })),
      open: () => {
        const { name, doc } = editor.getState();
        // Each export starts the form on the project's name; what was typed stays while that export is on screen.
        setFormState((was) => (was.title === "" ? { ...was, title: defaultTitle(name) } : was));
        setShort(showsAsShort({ width: doc.width, height: doc.height, seconds: frameCount(doc) / doc.fps }));
        setStep({ at: "form", error: null });
      },
      back: () => setStep(CLOSED),
      submit,
      cancel: () => running.current.controller?.abort(),
      close: () => {
        running.current.controller?.abort();
        setStep(CLOSED);
        setFormState({ title: "", description: "", visibility: "private", madeForKids: false });
      },
    };
  }, [status, step, form, short, posting, exporter, editor]);
}

// On the "done" screen, when the space could post but has no working channel: who can fix that, and where.
export function PostOffer({ panel }: { panel: PostPanel }): ReactNode {
  const { status } = panel;
  if (!status || (status.channel !== null && !status.broken)) return null;
  const what = status.broken ? "The YouTube channel needs connecting again before anyone can post to it." : "Connect a YouTube channel to post videos from here.";
  if (!status.canConnect) return <p className={MUTED}>{status.broken ? SOCIAL_MESSAGES.broken : "An admin of this space can connect a YouTube channel in Settings, Socials."}</p>;
  return (
    <p className={MUTED}>
      {what}{" "}
      {/* A new tab: leaving the editor would drop the file that was just exported. */}
      <a href={status.settingsPath} target="_blank" rel="noreferrer" className="rounded-sm text-ed-text underline underline-offset-2">
        Open Socials settings
      </a>
    </p>
  );
}

// The button on the "done" screen. Only with a working channel.
export function PostButton({ panel }: { panel: PostPanel }): ReactNode {
  const { status } = panel;
  if (!status || status.channel === null || status.broken) return null;
  return <Button onClick={panel.open}>Post to YouTube</Button>;
}

export function PostBody({ panel }: { panel: PostPanel }): ReactNode {
  const { step, form, status } = panel;
  const channel = status?.channel ?? "YouTube";
  if (step.at === "uploading") {
    return (
      <div className="flex flex-col gap-2">
        <p>{`Posting to ${channel}…`}</p>
        <progress
          aria-label="Upload progress"
          value={step.sentBytes}
          max={step.totalBytes}
          className="block h-1.5 w-full appearance-none overflow-hidden rounded-full border-0 bg-ed-raised [&::-moz-progress-bar]:bg-ed-accent [&::-webkit-progress-bar]:bg-ed-raised [&::-webkit-progress-value]:bg-ed-accent [&::-webkit-progress-value]:transition-none"
        />
        <p className={`tabular-nums ${MUTED}`}>{`${formatBytes(step.sentBytes)} of ${formatBytes(step.totalBytes)}`}</p>
        <p className={MUTED}>Keep this tab open until it finishes.</p>
      </div>
    );
  }
  if (step.at === "posted") {
    return (
      <div className="flex flex-col gap-2">
        <p role="status" className="font-medium">{`Posted to ${channel}.`}</p>
        {step.url && (
          <p>
            <a href={step.url} target="_blank" rel="noreferrer" className="rounded-sm underline underline-offset-2">
              Open on YouTube
            </a>
          </p>
        )}
        <p className={MUTED}>
          {step.visibility === "private" ? "It's private: only you can see it until you change that on YouTube. " : ""}
          YouTube may take a few minutes to finish processing it.
        </p>
      </div>
    );
  }
  if (step.at !== "form") return null;
  return (
    <div className="flex flex-col gap-3">
      <p className={MUTED}>{`Post this video to ${channel} on YouTube.`}</p>
      <Field label="Title">
        <TextInput value={form.title} maxLength={200} onChange={(event) => panel.setForm({ title: event.target.value })} />
      </Field>
      <Field label="Description">
        <TextArea rows={3} value={form.description} onChange={(event) => panel.setForm({ description: event.target.value })} />
      </Field>
      <Field label="Who can see it">
        <Select value={form.visibility} onChange={(event) => isVisibility(event.target.value) && panel.setForm({ visibility: event.target.value })}>
          {VISIBILITIES.map((visibility) => (
            <option key={visibility} value={visibility}>
              {VISIBILITY_LABELS[visibility]}
            </option>
          ))}
        </Select>
      </Field>
      <Toggle label="This video is made for kids" checked={form.madeForKids} onChange={(madeForKids) => panel.setForm({ madeForKids })} />
      {panel.short && <p className={MUTED}>YouTube will show this as a Short: it is upright and three minutes or less.</p>}
      {step.error && (
        <p role="alert" className="text-ed-danger">
          {step.error}
        </p>
      )}
    </div>
  );
}

export function PostFooter({ panel, onDone }: { panel: PostPanel; onDone(): void }): ReactNode {
  const { step } = panel;
  if (step.at === "uploading") return <Button onClick={panel.cancel}>Cancel</Button>;
  if (step.at === "posted") {
    return (
      <Button variant="primary" onClick={onDone}>
        Done
      </Button>
    );
  }
  // The second click of a double-click starts nothing. A key press has detail 0.
  const post = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1) return;
    panel.submit();
  };
  return (
    <>
      <Button onClick={panel.back}>Back</Button>
      <Button variant="primary" onClick={post}>
        Post
      </Button>
    </>
  );
}
