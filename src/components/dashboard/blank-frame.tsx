import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import type { FrameSize } from "@/lib/timeline/types";

// A black frame in a project's shape, as large as fits in its parent either way: the wrapper fills the
// parent and is a size container, so the frame's width is the smaller of the parent's width and the
// width its height allows. Only a picture, so screen readers skip it. Children are drawn inside the frame.
export function BlankFrame({
  width,
  height,
  className,
  children,
}: FrameSize & { className?: string; children?: ReactNode }): ReactNode {
  return (
    <div aria-hidden className={cx("flex size-full items-center justify-center [container-type:size]", className)}>
      <div
        data-blank-frame
        className="bg-black outline outline-ed-line"
        style={{ aspectRatio: `${width} / ${height}`, width: `min(100cqw, ${width / height} * 100cqh)` }}
      >
        {children}
      </div>
    </div>
  );
}
