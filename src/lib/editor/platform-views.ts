// "View as": how a frame looks once a platform shows it. Everything is a share of the frame (0 to 1), so one list
// fits every size. Covered areas come from the platforms' published safe zones (Meta's Reels guidance, Google's
// vertical video diagram for Shorts, TikTok's In-Feed template); the buttons and captions are plain stand-ins, not
// the apps' real artwork. A crop is the centred box of that shape a feed or grid shows; the rest is dimmed.

export type Box = { x: number; y: number; w: number; h: number };
export type Mark = Box & { kind: "dot" | "line" | "pill" }; // a dot's h is ignored: it is round, w across

export type PlatformView = {
  id: string;
  label: string;
  covered: Box[]; // hidden under the app's buttons, captions and bars
  marks: Mark[];
  crop?: number; // width / height of the part shown, centred
};

const dot = (x: number, y: number, w = 0.085): Mark => ({ kind: "dot", x, y, w, h: 0 });
const line = (x: number, y: number, w: number): Mark => ({ kind: "line", x, y, w, h: 0.012 });
const pill = (x: number, y: number, w: number): Mark => ({ kind: "pill", x, y, w, h: 0.042 });

// The frame minus margins on each side, as four covered strips.
function margins(top: number, right: number, bottom: number, left: number): Box[] {
  const mid = 1 - top - bottom;
  return [
    { x: 0, y: 0, w: 1, h: top },
    { x: 0, y: 1 - bottom, w: 1, h: bottom },
    { x: 0, y: top, w: left, h: mid },
    { x: 1 - right, y: top, w: right, h: mid },
  ];
}

const column = (x: number, ys: number[]) => ys.map((y) => dot(x, y));

const REELS = (id: string, label: string): PlatformView => ({
  id,
  label,
  covered: margins(0.14, 0.06, 0.35, 0.06),
  marks: [line(0.05, 0.04, 0.16), ...column(0.88, [0.6, 0.69, 0.78]), dot(0.04, 0.85, 0.07), line(0.14, 0.86, 0.34), line(0.04, 0.91, 0.6), line(0.04, 0.945, 0.4)],
});

const SHORTS: PlatformView = {
  id: "youtube-shorts",
  label: "YouTube Shorts",
  covered: margins(0.15, 0.178, 0.35, 0.044),
  marks: [dot(0.75, 0.03, 0.065), dot(0.88, 0.03, 0.065), ...column(0.865, [0.5, 0.59, 0.68, 0.77]), dot(0.04, 0.84, 0.07), line(0.14, 0.854, 0.3), pill(0.48, 0.846, 0.22), line(0.04, 0.91, 0.62), line(0.04, 0.945, 0.4)],
};

const TIKTOK: PlatformView = {
  id: "tiktok",
  label: "TikTok",
  // The button column takes more of the right over the lower part of the frame.
  covered: [...margins(0.125, 0.111, 0.344, 0.111).slice(0, 3), { x: 0.889, y: 0.125, w: 0.111, h: 0.315 }, { x: 0.722, y: 0.44, w: 0.278, h: 0.216 }],
  marks: [line(0.28, 0.05, 0.18), line(0.52, 0.05, 0.2), ...column(0.875, [0.44, 0.53, 0.62, 0.71, 0.8]), line(0.04, 0.84, 0.34), line(0.04, 0.89, 0.58), line(0.04, 0.94, 0.4)],
};

const crop = (id: string, label: string, shape: number): PlatformView => ({ id, label, covered: [], marks: [], crop: shape });

const YOUTUBE_VIDEO: PlatformView = {
  id: "youtube-video",
  label: "YouTube video",
  // The title bar and the controls show while paused or hovered.
  covered: [
    { x: 0, y: 0, w: 1, h: 0.12 },
    { x: 0, y: 0.86, w: 1, h: 0.14 },
  ],
  marks: [line(0.03, 0.045, 0.45), line(0.03, 0.885, 0.94), dot(0.03, 0.92, 0.03), dot(0.08, 0.92, 0.03), dot(0.13, 0.92, 0.03), dot(0.91, 0.92, 0.03), dot(0.95, 0.92, 0.03)],
};

const TALL: PlatformView[] = [
  REELS("instagram-reels", "Instagram Reels"),
  crop("instagram-feed", "Instagram feed", 4 / 5),
  crop("instagram-grid", "Instagram profile grid", 3 / 4),
  SHORTS,
  TIKTOK,
  REELS("facebook-reels", "Facebook Reels"),
  crop("facebook-feed", "Facebook feed", 4 / 5),
  crop("linkedin-feed", "LinkedIn feed", 4 / 5),
];

const FEED: PlatformView[] = [crop("instagram-grid", "Instagram profile grid", 3 / 4)];

const WIDE: PlatformView[] = [YOUTUBE_VIDEO];

// The places a frame of this shape is usually posted: vertical video goes to every short-form app and is cropped in
// the feeds, feed and square posts are cropped on the Instagram grid, and landscape goes to YouTube.
export function platformViewsFor(size: { width: number; height: number }): PlatformView[] {
  const shape = size.width / size.height;
  if (shape < 0.75) return TALL;
  if (shape <= 1.2) return FEED;
  return WIDE;
}

export function platformView(size: { width: number; height: number }, id: string | null): PlatformView | null {
  return (id && platformViewsFor(size).find((v) => v.id === id)) || null;
}

// The centred box of the view's crop shape inside the frame, as shares of the frame.
export function cropBox(frameShape: number, cropShape: number): Box {
  if (cropShape > frameShape) {
    const h = frameShape / cropShape;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = cropShape / frameShape;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}
