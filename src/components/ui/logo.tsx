// The EasyEdit mark: a play button with two more frames fanned ahead of it, each a deeper blue than the one before.
// The three blues are --logo-1, --logo-2 and --logo-3 in globals.css, front to back: a lighter set on dark pages and
// the same set one step deeper on light ones, so the mark needs no tile behind it.
// Plain paths on a grid 150 units tall, with no masks or ids, so a page can show it any number of times.
// Every edge is vertical or 30 degrees off the horizontal. The frames step 46 units to the right.
const FULL = {
  width: 221.9,
  shapes: [
    "M0 0L129.9 75L0 150Z",
    "M46 0L175.9 75L46 150L46 136.14L151.9 75L46 13.86Z",
    "M92 0L221.9 75L92 150L92 136.14L197.9 75L92 13.86Z",
  ],
};

// Small, the gaps between three frames close up. Under SMALL_BELOW pixels tall the mark is drawn with one frame ahead
// of the play button, heavier and with a wider gap. The favicon in src/app is this drawing on the editor's dark tile;
// the larger app icon there is the full one.
const SMALL = {
  width: 197.9,
  shapes: ["M0 0L129.9 75L0 150Z", "M68 0L197.9 75L68 150L68 126.91L157.9 75L68 23.09Z"],
};
const SMALL_BELOW = 24;

const HEIGHT = 150;
const FILLS = ["var(--logo-1)", "var(--logo-2)", "var(--logo-3)"];

type LogoMarkProps = {
  size?: number; // the height in CSS pixels; the mark is about one and a half times as wide
  className?: string;
  title?: string; // set it when the mark stands alone; leave it out beside the written name, which already says it
};

export function LogoMark({ size = 20, className, title }: LogoMarkProps) {
  const drawing = size < SMALL_BELOW ? SMALL : FULL;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${drawing.width} ${HEIGHT}`}
      width={Math.round((size * drawing.width) / HEIGHT)}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {drawing.shapes.map((d, i) => (
        <path key={d} fill={FILLS[i]} d={d} />
      ))}
    </svg>
  );
}
