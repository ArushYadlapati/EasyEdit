"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@/components/ui/button";
import { linkButtonClass } from "@/components/ui/button-class";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { connectChannelHref, connectNote, POST_STATUS_LABELS, SOCIAL_MESSAGES } from "@/lib/social/messages";
import type { SocialFormState } from "@/lib/social/social-actions";
import type { SocialsSettingsView } from "@/lib/social/view";
import { settingsTabPath } from "@/lib/spaces/settings-tabs";
import { timeAgo } from "@/lib/time-ago";

export type SocialsSettingsProps = {
  view: SocialsSettingsView;
  note: string | null; // ?youtube=… as the address has it; only the known ones say anything
  disconnect(): Promise<SocialFormState>; // Disconnect, with the space bound
  now?: Date; // when the page was drawn, for "5 minutes ago"; a test gives one
};

const TEXT = "text-[13px] leading-5 text-ed-text";
const MUTED = "text-[13px] leading-5 text-ed-muted";
const ROW = "flex flex-wrap items-center gap-2";
const VISIBILITY = { private: "Private", unlisted: "Unlisted", public: "Public" } as const;

// Starting a connect is a full page load (the route sends the browser on to Google), so it is a plain link.
function ConnectLink({ spaceId, primary, children }: { spaceId: string; primary?: boolean; children: ReactNode }) {
  return (
    <a href={connectChannelHref(spaceId)} className={linkButtonClass(primary ? "primary" : "default", "max-w-full")}>
      <span className="min-w-0 truncate">{children}</span>
    </a>
  );
}

// Asks first; after it, the page shows the space with no channel and a line saying posted videos stay.
function DisconnectControl({ name, slug, disconnect }: { name: string; slug: string; disconnect(): Promise<SocialFormState> }): ReactNode {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const run = useAction(async () => disconnect());
  return (
    <>
      <Button variant="danger" onClick={() => setAsking(true)}>
        {SOCIAL_MESSAGES.disconnect}
      </Button>
      <ConfirmDialog
        title={`Disconnect ${name}?`}
        question={SOCIAL_MESSAGES.disconnectQuestion}
        confirmLabel={SOCIAL_MESSAGES.disconnect}
        open={asking}
        pending={run.pending}
        error={run.error}
        onConfirm={() =>
          run.submit(new FormData(), {
            onSuccess: () => {
              setAsking(false);
              router.replace(`${settingsTabPath(slug, "socials")}?youtube=disconnected`);
            },
          })
        }
        onClose={() => setAsking(false)}
      />
    </>
  );
}

// The Socials tab of a space's settings, for its admins: the YouTube channel the space posts to, the ways to change
// it, and what was posted lately.
export function SocialsSettings({ view, note, disconnect, now }: SocialsSettingsProps): ReactNode {
  const headingId = useId();
  const postsId = useId();
  const { space, youtube, posts } = view;
  const shown = connectNote(note);
  const drawnAt = now ?? new Date();

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <h2 id={headingId} className="text-sm font-semibold text-ed-text">
          YouTube
        </h2>
        {shown && (
          <p role={shown.tone === "error" ? "alert" : "status"} className={cx("text-[13px] leading-5", shown.tone === "error" ? "text-ed-danger" : "text-ed-text")}>
            {shown.text}
          </p>
        )}
        {youtube === null ? (
          <>
            <p className={TEXT}>{SOCIAL_MESSAGES.intro}</p>
            <div className={ROW}>
              <ConnectLink spaceId={space.id} primary>
                {SOCIAL_MESSAGES.connect}
              </ConnectLink>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p className={cx(TEXT, "break-words")}>
                Posting to <span className="font-medium">{youtube.name}</span>
              </p>
              {youtube.email && <p className={cx(MUTED, "break-words")}>Google account: {youtube.email}</p>}
              {youtube.connectedBy && (
                <p className={MUTED}>
                  Connected by {youtube.connectedBy}
                  {space.kind === "team" ? ". If they leave this team, the channel is disconnected." : ""}
                </p>
              )}
            </div>
            {youtube.broken && (
              <p role="alert" className="text-[13px] leading-5 text-ed-danger">
                {SOCIAL_MESSAGES.brokenHere}
              </p>
            )}
            <div className={ROW}>
              <ConnectLink spaceId={space.id} primary={youtube.broken}>
                {youtube.broken ? SOCIAL_MESSAGES.connectAgain : SOCIAL_MESSAGES.useDifferent}
              </ConnectLink>
              <DisconnectControl name={youtube.name} slug={space.slug} disconnect={disconnect} />
            </div>
            <p className={MUTED}>{`Anyone who can edit in this space can post to it, up to ${view.postsPerDay} videos a day. Nothing is posted until someone presses Post.`}</p>
          </>
        )}
      </section>

      {(youtube !== null || posts.length > 0) && (
        <section aria-labelledby={postsId} className="flex flex-col gap-2">
          <h2 id={postsId} className="text-sm font-semibold text-ed-text">
            {SOCIAL_MESSAGES.postsHeading}
          </h2>
          {posts.length === 0 ? (
            <p className={MUTED}>{SOCIAL_MESSAGES.noPosts}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-ed-line rounded-md border border-ed-line">
              {posts.map((post) => (
                <li key={post.id} className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
                  {post.url ? (
                    <a href={post.url} target="_blank" rel="noreferrer" className={cx("self-start truncate rounded-sm text-[13px] font-medium text-ed-text underline-offset-2 hover:underline", "max-w-full", FOCUS_RING, FADE)}>
                      {post.title}
                    </a>
                  ) : (
                    <p className="truncate text-[13px] font-medium text-ed-text">{post.title}</p>
                  )}
                  <p className="text-xs text-ed-muted">
                    {[POST_STATUS_LABELS[post.status], VISIBILITY[post.visibility], post.postedBy, post.projectName ? `from ${post.projectName}` : null, timeAgo(new Date(post.createdAt), drawnAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
