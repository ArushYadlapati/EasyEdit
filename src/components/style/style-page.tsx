"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { CopyButton } from "@/app/(dashboard)/agents/copy";
import { MediaProvider, createMediaServices, gateStorage, useLibrary, type MediaServices } from "@/components/editor/media/media-context";
import { isStyleSaved } from "@/lib/mcp/style-text";
import { STYLE_WORDS } from "@/lib/style/messages";
import type { Style, StyleReference } from "@/lib/style/types";
import { LeaveGuard } from "./leave-guard";
import { LearnSection } from "./learn-section";
import type { StyleProject } from "./pick-projects-dialog";
import { BROWSER_STYLE_API, type StyleApi } from "./style-api";
import { StyleForm } from "./style-form";

export type { StyleProject } from "./pick-projects-dialog";

const T = STYLE_WORDS.tryIt;
const L = STYLE_WORDS.leave;

// What leaving the page would lose, for the question asked first: the form's changes Save hasn't sent, an upload
// still running (leaving stops it), and a video still being looked at (it starts over next time).
function PageLeaveGuard({ unsaved, looking }: { unsaved: boolean; looking: boolean }) {
  const uploading = useLibrary((s) => s.uploads.some((item) => item.stage !== "done" && item.stage !== "failed"));
  const reasons: string[] = [];
  if (unsaved) reasons.push(L.unsaved);
  if (uploading) reasons.push(L.uploading);
  if (looking) reasons.push(L.looking);
  return <LeaveGuard reasons={reasons} />;
}

// "Try it": the line to ask an agent, with Copy.
function TryIt({ spaceName }: { spaceName: string | null }) {
  const headingId = useId();
  const line = T.line(spaceName);
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h2 id={headingId} className="text-sm font-semibold text-ed-text">
        {T.heading}
      </h2>
      <p className="text-[13px] leading-5 text-ed-muted">{T.intro}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 basis-56 rounded-md border border-ed-line bg-ed-raised px-3 py-1 text-[13px] leading-5 break-words text-ed-text">{line}</p>
        <CopyButton text={line} label={T.copy} />
      </div>
    </section>
  );
}

export type StylePageProps = {
  spaceId: string;
  spaceSlug: string;
  spaceName: string | null; // null for a personal space, which has no name to give an agent
  canEdit: boolean; // an editor or an admin
  isAdmin: boolean; // can connect the space's YouTube channel, in Socials
  initialStyle: Style;
  initialReferences: StyleReference[];
  projects: StyleProject[]; // the space's most recent projects, newest first, to pick from
  storageReady: boolean;
  channelOn: boolean; // the space has a YouTube channel connected whose videos this server can read
  services?: MediaServices; // tests give their own
  api?: StyleApi; // tests give their own
  now?: Date; // when the server drew the page, for "2 hours ago", so the browser's first drawing says the same
};

// The Style tab of a space's settings: what the style learns from (videos, links, past projects, the YouTube
// channel), the style itself, and, once it has something for agents to read, what to ask one. The space's media
// library is loaded here too, for the videos' pictures and to pick or upload one, as the Brand kit page does. Leaving
// while something would be lost (changes not saved, an upload, a video being looked at) asks first. Viewers see it
// all with nothing to change.
export function StylePage({
  spaceId,
  spaceSlug,
  spaceName,
  canEdit,
  isAdmin,
  initialStyle,
  initialReferences,
  projects,
  storageReady,
  channelOn,
  services,
  api,
  now,
}: StylePageProps): ReactNode {
  const media = useMemo(() => services ?? gateStorage(createMediaServices(spaceId), storageReady), [services, spaceId, storageReady]);
  const calls = api ?? BROWSER_STYLE_API;
  const [references, setReferences] = useState(initialReferences);
  const [style, setStyle] = useState(initialStyle);
  const [unsaved, setUnsaved] = useState(false);
  const [looking, setLooking] = useState(false);
  useEffect(() => {
    media.library.getState().refresh("open").catch(() => {});
    return () => media.dispose();
  }, [media]);

  return (
    <MediaProvider services={media} spaceId={spaceId} storageReady={storageReady}>
      <div className="flex min-w-0 flex-col gap-8">
        <p className="text-[13px] leading-5 text-ed-muted">{canEdit ? STYLE_WORDS.intro : STYLE_WORDS.introViewer}</p>
        <LearnSection
          spaceId={spaceId}
          spaceSlug={spaceSlug}
          canEdit={canEdit}
          isAdmin={isAdmin}
          channelOn={channelOn && canEdit}
          references={references}
          setReferences={setReferences}
          projects={projects}
          api={calls}
          now={now}
          onLooking={setLooking}
        />
        <StyleForm
          spaceId={spaceId}
          canEdit={canEdit}
          initial={initialStyle}
          references={references}
          save={calls.saveStyle}
          now={now}
          onChanged={setUnsaved}
          onSaved={setStyle}
        />
        {/* As the agent's guide has it: with nothing saved and nothing to learn from, there is no style to ask for. */}
        {canEdit && isStyleSaved(style, references) && <TryIt spaceName={spaceName} />}
      </div>
      {canEdit && <PageLeaveGuard unsaved={unsaved} looking={looking} />}
    </MediaProvider>
  );
}
