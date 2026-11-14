"use client";

import { FOCUS_RING, cx } from "@/components/ui/cx";
import { MESSAGES, goToSelection, peerStatus } from "@/lib/editor/messages";
import { earliestStart, localClips, peerSummary, type Peer } from "@/lib/editor/presence";
import { useEditor } from "./context";
import { PEER_MORE, peerLook } from "./peer-look";
import { usePresence } from "./presence-context";

// The people drawn as their own dot; the rest fold into one "+N" dot.
const SHOWN = 3;

// A 24 px target, so the dots are easy to hit, with initials on the person's colour.
const DOT = "size-6 shrink-0 rounded-full text-center text-[10px] font-semibold leading-6";

// Who else has this project open, one dot each, which is also the key to their colours on the board and the timeline.
// A group, not a live region, so people coming and going are not announced.
export function PresentPeople() {
  const peers = usePresence((s) => s.peers);
  const meColour = usePresence((s) => s.meColour);
  if (peers.length === 0) return null;
  const rest = peers.slice(SHOWN);
  const restNames = rest.map((p) => p.name).join(", ");
  return (
    <div role="group" aria-label={MESSAGES.alsoHere} className="flex shrink-0 items-center gap-1">
      {meColour !== null && (
        <span
          role="img"
          aria-label={MESSAGES.you}
          title={MESSAGES.you}
          className={cx("mr-0.5 size-2.5 shrink-0 rounded-full", peerLook(meColour).bg)}
        />
      )}
      {peers.slice(0, SHOWN).map((peer) => (
        <PeerDot key={peer.userId} peer={peer} />
      ))}
      {rest.length > 0 && (
        <span role="img" aria-label={restNames} title={restNames} className={cx(DOT, PEER_MORE)}>
          +{rest.length}
        </span>
      )}
    </div>
  );
}

// A button that shows you their clips when any of them exist here; otherwise just what they have selected.
function PeerDot({ peer }: { peer: Peer }) {
  const doc = useEditor((s) => s.doc);
  const seek = useEditor((s) => s.seek);
  const look = cx(DOT, "text-ed-bg", peerLook(peer.colour).bg);
  const start = earliestStart(peer, doc);
  if (start === null) {
    const label = peerStatus(peer.name, peerSummary(peer, doc));
    return (
      <span role="img" aria-label={label} title={label} className={look}>
        {peer.initials}
      </span>
    );
  }
  const label = goToSelection(peer.name, localClips(peer, doc).length);
  // Only the playhead moves: the timeline scrolls to it and the board outlines their clip. Your selection stays.
  return (
    <button type="button" aria-label={label} title={label} className={cx(look, FOCUS_RING)} onClick={() => seek(start)}>
      {peer.initials}
    </button>
  );
}
