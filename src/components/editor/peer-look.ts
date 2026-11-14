// The classes that draw a teammate in their colour, one entry per colour slot. Written out in full, because Tailwind
// only generates classes it finds spelled out in the source.
export type PeerLook = {
  stroke: string; // board outlines
  bg: string; // name pills, initials chips, top-bar dots, the track band's left bar
  border: string; // timeline rings, the track band's lines
  text: string;
};

// One entry per slot of PEER_COLOURS in presence.ts.
export const PEER_LOOKS: readonly PeerLook[] = [
  { stroke: "stroke-ed-peer-1", bg: "bg-ed-peer-1", border: "border-ed-peer-1", text: "text-ed-peer-1" },
  { stroke: "stroke-ed-peer-2", bg: "bg-ed-peer-2", border: "border-ed-peer-2", text: "text-ed-peer-2" },
  { stroke: "stroke-ed-peer-3", bg: "bg-ed-peer-3", border: "border-ed-peer-3", text: "text-ed-peer-3" },
  { stroke: "stroke-ed-peer-4", bg: "bg-ed-peer-4", border: "border-ed-peer-4", text: "text-ed-peer-4" },
  { stroke: "stroke-ed-peer-5", bg: "bg-ed-peer-5", border: "border-ed-peer-5", text: "text-ed-peer-5" },
];

// The look of a colour slot from presence.ts (0 is --ed-peer-1). A slot out of range wraps, never throws.
export function peerLook(colour: number): PeerLook {
  return PEER_LOOKS[((Math.trunc(colour) % PEER_LOOKS.length) + PEER_LOOKS.length) % PEER_LOOKS.length];
}

// A "+N" pill, chip or dot for the people beyond those drawn.
export const PEER_MORE = "bg-ed-raised text-ed-muted";
