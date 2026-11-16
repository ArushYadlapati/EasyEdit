// The EasyEdit mark: an E made of three timeline tracks, cut through by one diagonal razor cut. Everything after the cut
// takes the logo accent (--logo-accent in globals.css: the editor's blue on dark pages, a deeper blue on light ones), and
// the rest takes the text colour around it, so the same mark works on every page without a tile behind it.
// Plain polygons on a 64-unit grid, with no masks or ids, so a page can show it any number of times.
// The favicon and app icons in src/app are the same drawing on the editor's dark tile.
const LEFT =
  "M14.72 14.72L39.25 14.72L37.33 22.4L24.32 22.4L24.32 28.16L35.89 28.16L33.97 35.84L24.32 35.84L24.32 41.6L32.53 41.6L30.61 49.28L14.72 49.28Z";
const RIGHT =
  "M42.03 14.72L49.28 14.72L49.28 22.4L40.11 22.4ZM38.67 28.16L46.4 28.16L46.4 35.84L36.75 35.84ZM35.31 41.6L49.28 41.6L49.28 49.28L33.39 49.28Z";

// The drawing fills 15 to 49 of the 64 units; the viewBox crops to it (plus a hair) so the mark lines up with text.
const VIEW_BOX = "14 14 36 36";

type LogoMarkProps = {
  size?: number; // in CSS pixels; the mark is square
  className?: string;
  title?: string; // set it when the mark stands alone; leave it out beside the written name, which already says it
};

export function LogoMark({ size = 20, className, title }: LogoMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={VIEW_BOX}
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path fill="currentColor" d={LEFT} />
      <path fill="var(--logo-accent)" d={RIGHT} />
    </svg>
  );
}
