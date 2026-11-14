"use client";

import { memo, useMemo } from "react";
import { cx } from "@/components/ui/cx";
import { HEADER_WIDTH, ROW_HEIGHT, frameToPx, visibleClips } from "@/lib/editor/geometry";
import { clipMarks, trackMarks, type Peer } from "@/lib/editor/presence";
import { viewDoc } from "@/lib/editor/store";
import type { Track } from "@/lib/timeline";
import { useEditor } from "../context";
import { PEER_MORE, peerLook } from "../peer-look";
import { usePresence } from "../presence-context";
import { CLIP_HEIGHT, CLIP_TOP } from "./clip-view";
import { LANE_GUTTER } from "./playhead";

const RINGS_PER_CLIP = 2; // the first person's ring is 2 px outside the clip, the second's 4 px
const RING_GAP_PX = 2;
const MIN_CHIPS_PX = 40; // a narrower ring carries no initials; its colour and the top-bar key say who it is

type Ring = { key: string; peer: Peer; left: number; top: number; width: number; height: number; chips: Peer[] | null; more: number };
type Band = { trackId: string; peer: Peer; top: number };

type PeerSelectionsProps = {
  rows: Track[];
  zoom: number; // the timeline's clamped zoom
  fromFrame: number; // only clips overlapping this range get a ring, as the rows render only those
  toFrame: number;
};

// What teammates have selected, drawn over the rows: a ring in their colour around each of their clips, and lines and
// a bar on a track they selected. It reads the doc as you see it, so the rings follow your own drag preview, and it
// re-renders on its own when the list changes, so a check never re-renders a row. Nothing here takes the pointer.
export const PeerSelections = memo(function PeerSelections({ rows, zoom, fromFrame, toFrame }: PeerSelectionsProps) {
  const peers = usePresence((s) => s.peers);
  const doc = useEditor(viewDoc);

  const { rings, bands } = useMemo(() => {
    const rings: Ring[] = [];
    const bands: Band[] = [];
    if (peers.length === 0) return { rings, bands };
    const rowOf = new Map(rows.map((t, i) => [t.id, i]));
    const onClips = clipMarks(peers);
    for (const track of doc.tracks) {
      const row = rowOf.get(track.id);
      if (row === undefined) continue;
      // Clips a teammate selected that are deleted here, or whose edit has not arrived yet, are simply not found.
      for (const clip of visibleClips(track.clips, fromFrame, toFrame)) {
        const on = onClips.get(clip.id);
        if (!on) continue;
        const clipWidth = Math.max(2, frameToPx(clip.duration, zoom));
        on.slice(0, RINGS_PER_CLIP).forEach((peer, i) => {
          const out = RING_GAP_PX * (i + 1);
          const width = clipWidth + 2 * out;
          const first = i === 0 && width >= MIN_CHIPS_PX;
          rings.push({
            key: `${clip.id}:${peer.userId}`,
            peer,
            left: HEADER_WIDTH + LANE_GUTTER + frameToPx(clip.start, zoom) - out,
            top: row * ROW_HEIGHT + CLIP_TOP - out,
            width,
            height: CLIP_HEIGHT + 2 * out,
            chips: first ? on.slice(0, RINGS_PER_CLIP) : null,
            more: first ? on.length - RINGS_PER_CLIP : 0,
          });
        });
      }
    }
    // A track several people selected shows the first of them.
    for (const [trackId, on] of trackMarks(peers)) {
      const row = rowOf.get(trackId);
      if (row !== undefined) bands.push({ trackId, peer: on[0], top: row * ROW_HEIGHT });
    }
    return { rings, bands };
  }, [peers, doc, rows, zoom, fromFrame, toFrame]);

  return (
    <>
      {rings.map(({ key, peer, left, top, width, height, chips, more }) => (
        // Never overflow-hidden: the initials stick inside the visible part of a long ring.
        <div
          key={key}
          aria-hidden
          data-peer-clip
          className={cx("pointer-events-none absolute z-10 flex items-start rounded-[6px] border", peerLook(peer.colour).border)}
          style={{ left, top, width, height }}
        >
          {chips && (
            // Sticky between the header (240 px, plus 8) and the right edge, so the initials stay in view on a long clip.
            <div data-peer-chips className="sticky right-2 left-[248px] ml-auto flex gap-0.5 p-0.5">
              {chips.map((p) => (
                <span key={p.userId} className={cx("size-3.5 rounded-full text-center text-[9px] font-semibold leading-3.5 text-ed-bg", peerLook(p.colour).bg)}>
                  {p.initials}
                </span>
              ))}
              {more > 0 && <span className={cx("size-3.5 rounded-full text-center text-[9px] font-semibold leading-3.5", PEER_MORE)}>+{more}</span>}
            </div>
          )}
        </div>
      ))}
      {bands.map(({ trackId, peer, top }) => {
        const look = peerLook(peer.colour);
        // Above the sticky headers (z-20), below the sticky ruler (z-30). Solid lines only: dashes mean "drops here",
        // and your own selected-header tint still shows through.
        return (
          <div
            key={trackId}
            aria-hidden
            data-peer-track={trackId}
            className={cx("pointer-events-none absolute inset-x-0 z-[25] border-y", look.border)}
            style={{ top, height: ROW_HEIGHT }}
          >
            <div data-peer-track-bar className={cx("sticky left-0 h-full w-[3px]", look.bg)} />
          </div>
        );
      })}
    </>
  );
});
