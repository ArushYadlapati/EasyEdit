"use client";

import { Clapperboard, Film, Link2, ListVideo } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useLibrary, useMedia } from "@/components/editor/media/media-context";
import { Button } from "@/components/ui/button";
import { LIMITS } from "@/lib/limits";
import type { AssetView } from "@/lib/media/types";
import type { ChannelUpload } from "@/lib/social/youtube-api";
import { channelFactsStale } from "@/lib/style/describe";
import { parseVideoLink } from "@/lib/style/links";
import { STYLE_MESSAGES, STYLE_WORDS } from "@/lib/style/messages";
import type { StyleReference } from "@/lib/style/types";
import { AddVideoDialog } from "./add-video-dialog";
import { ChannelDialog } from "./channel-dialog";
import { PasteLink } from "./paste-link";
import { PickProjectsDialog, type StyleProject } from "./pick-projects-dialog";
import { ReferenceCard } from "./reference-card";
import { failureWords, type StyleApi } from "./style-api";
import { useAnalyzeReference } from "./use-analyze-reference";

const W = STYLE_WORDS.learn;
const MUTED = "text-[13px] leading-5 text-ed-muted";

type Opened = "video" | "link" | "projects" | "channel" | null;

const without = <T,>(set: ReadonlySet<T>, item: T): ReadonlySet<T> => new Set([...set].filter((other) => other !== item));
const withoutKey = (record: Readonly<Record<string, string>>, key: string) => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

export type LearnSectionProps = {
  spaceId: string;
  spaceSlug: string;
  canEdit: boolean;
  isAdmin: boolean;
  channelOn: boolean; // this server can read a YouTube channel's uploads
  references: StyleReference[];
  setReferences: Dispatch<SetStateAction<StyleReference[]>>;
  projects: readonly StyleProject[];
  api: StyleApi;
  now?: Date;
};

// "Learn from your videos": what the style learns from, as a list of cards, and for editors the ways to add to it (a
// video from the space's media or a new upload, a pasted link, past projects, and the space's YouTube channel where
// this server can read one). A video added, or still waiting, is looked over in this browser straight away, once,
// one video at a time; a video that couldn't be offers Try again. A viewer, who can't add anything, sees the list
// under "What your style learns from".
export function LearnSection({ spaceId, spaceSlug, canEdit, isAdmin, channelOn, references, setReferences, projects, api, now }: LearnSectionProps): ReactNode {
  const headingId = useId();
  const { library } = useMedia();
  const assets = useLibrary((s) => s.assets);
  const loaded = useLibrary((s) => s.loaded);
  const [opened, setOpened] = useState<Opened>(null);
  // Each opening draws its dialog afresh (as a new key), so it starts empty and asks the server again.
  const [openings, setOpenings] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [videoProblem, setVideoProblem] = useState<string | null>(null);
  const [addingVideo, setAddingVideo] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const drawnAt = now ?? new Date();
  const full = references.length >= LIMITS.styleReferences;

  // A reference the server answered: a new one goes first; one already shown is changed where it is.
  const put = useCallback(
    (reference: StyleReference) =>
      setReferences((list) => (list.some((r) => r.id === reference.id) ? list.map((r) => (r.id === reference.id ? reference : r)) : [reference, ...list])),
    [setReferences],
  );
  // A reference looked over: changed where it is, unless it was removed meanwhile.
  const looked = useCallback((reference: StyleReference) => setReferences((list) => list.map((r) => (r.id === reference.id ? reference : r))), [setReferences]);
  const { run, progress, cancel } = useAnalyzeReference({
    onDone: looked,
    onError: (reference, message) => setErrors((shown) => ({ ...shown, [reference.id]: message })),
  });

  // Each waiting video is looked over once while the page is open, as soon as its video is in the library. Leaving the
  // page stops the runner, so what was started is forgotten too: React's development mode leaves and comes back once
  // straight away, and the runs it stopped start again.
  const started = useRef(new Set<string>());
  useEffect(() => {
    const begun = started.current;
    return () => begun.clear();
  }, []);
  useEffect(() => {
    if (!canEdit) return;
    for (const reference of references) {
      if (reference.kind !== "video" || reference.status !== "pending" || !reference.assetId || started.current.has(reference.id)) continue;
      const asset = assets[reference.assetId];
      if (!asset || asset.removed || asset.status !== "ready") continue;
      started.current.add(reference.id);
      void run(reference, asset);
    }
  }, [canEdit, references, assets, run]);
  // A waiting video the library didn't list is asked for by its id.
  useEffect(() => {
    if (!canEdit || !loaded) return;
    const missing = references.flatMap((r) => (r.kind === "video" && r.status === "pending" && r.assetId && !assets[r.assetId] ? [r.assetId] : []));
    if (missing.length > 0) library.getState().ensure(missing).catch(() => {});
  }, [canEdit, loaded, references, assets, library]);

  function tryAgain(reference: StyleReference) {
    const asset = reference.assetId ? assets[reference.assetId] : undefined;
    if (!asset || asset.removed) {
      setErrors((shown) => ({ ...shown, [reference.id]: STYLE_WORDS.analysisFailed.missing }));
      return;
    }
    setErrors((shown) => withoutKey(shown, reference.id));
    started.current.add(reference.id);
    void run(reference, asset);
  }

  async function remove(reference: StyleReference) {
    setBusy((held) => new Set([...held, reference.id]));
    setProblem(null);
    try {
      await api.removeReference(reference.id);
      cancel(reference.id);
      setReferences((list) => list.filter((r) => r.id !== reference.id));
      setErrors((shown) => withoutKey(shown, reference.id));
    } catch (error) {
      setProblem(failureWords(error));
    } finally {
      setBusy((held) => without(held, reference.id));
    }
  }

  // Reads a channel video's details from YouTube again, after they were cut back.
  async function refresh(reference: StyleReference) {
    const link = reference.url ? parseVideoLink(reference.url) : null;
    if (!link?.ok) return;
    setBusy((held) => new Set([...held, reference.id]));
    setProblem(null);
    try {
      put(await api.addChannelVideo(spaceId, link.id));
      setErrors((shown) => withoutKey(shown, reference.id));
    } catch (error) {
      setErrors((shown) => ({ ...shown, [reference.id]: failureWords(error) }));
    } finally {
      setBusy((held) => without(held, reference.id));
    }
  }

  async function pickVideo(asset: AssetView) {
    setAddingVideo(true);
    setVideoProblem(null);
    try {
      put(await api.addReference(spaceId, { kind: "video", assetId: asset.id }));
      setOpened(null);
    } catch (error) {
      setVideoProblem(failureWords(error));
    } finally {
      setAddingVideo(false);
    }
  }

  async function addLink(url: string): Promise<string | null> {
    try {
      put(await api.addReference(spaceId, { kind: "link", url }));
      setOpened(null);
      return null;
    } catch (error) {
      return failureWords(error);
    }
  }

  // Adds the projects one by one, in order, and stops at the first the server refuses.
  async function addProjects(ids: string[]): Promise<string | null> {
    for (const projectId of ids) {
      try {
        put(await api.addReference(spaceId, { kind: "project", projectId }));
      } catch (error) {
        return failureWords(error);
      }
    }
    return null;
  }

  async function addFromChannel(video: ChannelUpload): Promise<string | null> {
    try {
      put(await api.addChannelVideo(spaceId, video.id));
      return null;
    } catch (error) {
      return failureWords(error);
    }
  }

  const fetchChannel = useCallback(() => api.fetchChannel(spaceId), [api, spaceId]);
  const videosIn = new Set(references.flatMap((r) => (r.kind === "video" && r.assetId ? [r.assetId] : [])));
  const projectsIn = new Set(references.flatMap((r) => (r.kind === "project" && r.projectId ? [r.projectId] : [])));
  const urlsIn = new Set(references.flatMap((r) => (r.url ? [r.url] : [])));
  const open = (which: Exclude<Opened, null>) => {
    setOpenings((n) => n + 1);
    setOpened(which);
  };
  const openVideos = () => {
    setVideoProblem(null);
    open("video");
  };
  const close = () => setOpened(null);

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h2 id={headingId} className="text-sm font-semibold text-ed-text">
        {canEdit ? W.heading : W.headingViewer}
      </h2>
      {canEdit && <p className={MUTED}>{W.intro}</p>}
      {canEdit && (
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button disabled={full} aria-haspopup="dialog" onClick={openVideos}>
            <Film aria-hidden /> {W.addVideo}
          </Button>
          <Button disabled={full} aria-expanded={opened === "link"} onClick={() => setOpened(opened === "link" ? null : "link")}>
            <Link2 aria-hidden /> {W.pasteLink}
          </Button>
          <Button disabled={full} aria-haspopup="dialog" onClick={() => open("projects")}>
            <Clapperboard aria-hidden /> {W.pickProjects}
          </Button>
          {channelOn && (
            <Button disabled={full} aria-haspopup="dialog" onClick={() => open("channel")}>
              <ListVideo aria-hidden /> {W.fromChannel}
            </Button>
          )}
        </div>
      )}
      {canEdit && full && <p className={MUTED}>{STYLE_MESSAGES.tooManyReferences}</p>}
      {canEdit && opened === "link" && !full && <PasteLink add={addLink} onCancel={() => setOpened(null)} onUpload={openVideos} />}
      {problem && (
        <p role="alert" className="text-[13px] leading-5 text-ed-danger">
          {problem}
        </p>
      )}
      {references.length === 0 ? (
        <p className={MUTED}>{canEdit ? W.empty : W.emptyViewer}</p>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-ed-line rounded-md border border-ed-line">
          {references.map((reference) => {
            const stale = channelFactsStale(reference, drawnAt);
            return (
              <ReferenceCard
                key={reference.id}
                reference={reference}
                asset={reference.assetId ? assets[reference.assetId] : undefined}
                progress={progress[reference.id]}
                error={errors[reference.id] ?? null}
                canEdit={canEdit}
                stale={stale}
                busy={busy.has(reference.id)}
                onRemove={() => void remove(reference)}
                onTryAgain={() => tryAgain(reference)}
                onRefresh={channelOn ? () => void refresh(reference) : undefined}
              />
            );
          })}
        </ul>
      )}
      {/* The dialogs stay on the page while closed, so closing one hands the keyboard back to the button that opened it. */}
      {canEdit && (
        <>
          <AddVideoDialog open={opened === "video"} onClose={close} inStyle={videosIn} adding={addingVideo} problem={videoProblem} onPick={(asset) => void pickVideo(asset)} />
          <PickProjectsDialog
            key={`projects-${openings}`}
            open={opened === "projects"}
            onClose={close}
            projects={projects}
            inStyle={projectsIn}
            room={LIMITS.styleReferences - references.length}
            add={addProjects}
            now={now}
          />
          {channelOn && (
            <ChannelDialog
              key={`channel-${openings}`}
              open={opened === "channel"}
              onClose={close}
              spaceSlug={spaceSlug}
              isAdmin={isAdmin}
              inStyle={urlsIn}
              full={full}
              fetchChannel={fetchChannel}
              add={addFromChannel}
            />
          )}
        </>
      )}
    </section>
  );
}
