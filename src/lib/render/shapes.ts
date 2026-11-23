import { pathBetween, spotFromEnd, spotPoint, type PathSpot, type Pt } from "@/lib/timeline/arrow-path";
import { arrowLook, arrowPath, shapeCorners } from "@/lib/timeline/shapes";
import type { ShapeClip, ShapeDash } from "@/lib/timeline/types";
import type { Ctx2D } from "./compositor";

type Point = Pt;

// Dashes and dots are measured in line widths, so a pattern keeps its look at any thickness. A dot is a zero-length
// dash with round caps.
function setDash(ctx: Ctx2D, dash: ShapeDash, width: number): void {
  if (dash === "dashed") {
    ctx.setLineDash([3 * width, 2 * width]);
    ctx.lineCap = "butt";
  } else if (dash === "dotted") {
    ctx.setLineDash([0, 2 * width]);
    ctx.lineCap = "round";
  } else {
    ctx.setLineDash([]);
  }
}

// A rectangle path with each corner rounded by r (already clamped), drawn with arcTo so every canvas can take it.
function roundedRect(ctx: Ctx2D, w: number, h: number, r: number): void {
  const l = -w / 2;
  const t = -h / 2;
  ctx.beginPath();
  if (r <= 0) {
    ctx.rect(l, t, w, h);
    return;
  }
  ctx.moveTo(l + r, t);
  ctx.arcTo(l + w, t, l + w, t + h, r);
  ctx.arcTo(l + w, t + h, l, t + h, r);
  ctx.arcTo(l, t + h, l, t, r);
  ctx.arcTo(l, t, l + w, t, r);
  ctx.closePath();
}

// A path through these corners and closed, each corner rounded by up to r: as far as the two sides meeting there
// leave room for, each side sharing its length between its two corners.
function roundedCorners(ctx: Ctx2D, corners: Point[], r: number): void {
  const n = corners.length;
  ctx.beginPath();
  if (r <= 0) {
    corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    return;
  }
  const side = (i: number) => Math.hypot(corners[(i + 1) % n].x - corners[i].x, corners[(i + 1) % n].y - corners[i].y);
  const last = corners[n - 1];
  ctx.moveTo((last.x + corners[0].x) / 2, (last.y + corners[0].y) / 2);
  for (let i = 0; i < n; i++) {
    const before = corners[(i + n - 1) % n];
    const at = corners[i];
    const after = corners[(i + 1) % n];
    // The angle inside the corner: a rounding of radius r starts r / tan(half of it) along each side.
    const turn = Math.atan2(before.y - at.y, before.x - at.x) - Math.atan2(after.y - at.y, after.x - at.x);
    const half = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) / 2;
    const room = Math.min(side((i + n - 1) % n), side(i)) / 2;
    ctx.arcTo(at.x, at.y, after.x, after.y, Math.min(r, room * Math.tan(half)));
  }
  ctx.closePath();
}

function drawBox(ctx: Ctx2D, clip: ShapeClip): void {
  const { width: w, height: h } = clip;
  const corners = shapeCorners(clip);
  if (clip.shape === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (corners) {
    roundedCorners(ctx, corners, clip.radius ?? 0);
  } else {
    roundedRect(ctx, w, h, Math.min(clip.radius ?? 0, w / 2, h / 2));
  }
  if (clip.fill) {
    ctx.fillStyle = clip.fill;
    ctx.fill();
  }
  if (clip.stroke) {
    ctx.strokeStyle = clip.stroke;
    ctx.lineWidth = clip.strokeWidth;
    ctx.lineJoin = clip.shape !== "ellipse" && !clip.radius ? "miter" : "round";
    ctx.lineCap = "butt";
    setDash(ctx, clip.dash, clip.strokeWidth);
    ctx.stroke();
  }
}

// One head at `at`, pointing along `angle`, `length` long.
function drawHead(ctx: Ctx2D, clip: ShapeClip, at: Point, angle: number, length: number): void {
  const look = arrowLook(clip);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const back = { x: at.x - cos * length, y: at.y - sin * length };
  const nx = -sin;
  const ny = cos;
  ctx.setLineDash([]);
  if (look.head === "bar") {
    const half = length / 2;
    ctx.beginPath();
    ctx.moveTo(at.x + nx * half, at.y + ny * half);
    ctx.lineTo(at.x - nx * half, at.y - ny * half);
    ctx.lineCap = "round";
    ctx.stroke();
    return;
  }
  const half = length * 0.6;
  ctx.beginPath();
  ctx.moveTo(back.x + nx * half, back.y + ny * half);
  ctx.lineTo(at.x, at.y);
  ctx.lineTo(back.x - nx * half, back.y - ny * half);
  if (look.head === "triangle") {
    ctx.closePath();
    ctx.fillStyle = clip.stroke!;
    ctx.fill();
  } else {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }
}

function drawArrow(ctx: Ctx2D, clip: ShapeClip): void {
  const look = arrowLook(clip);
  const path = arrowPath(clip);
  const last = path.length - 1;
  const atEnd = look.heads === "end" || look.heads === "both";
  const atStart = look.heads === "start" || look.heads === "both";
  // A head never takes more than 45% of the way from tail to tip, so both heads on a short arrow still leave a line
  // between them.
  const headLength = Math.min(look.headSize * clip.strokeWidth, clip.width * 0.45);
  // A filled head covers the line's end, so the line stops just inside the head instead of poking out of its tip.
  const tuck = look.head === "triangle" ? headLength * 0.8 : 0;
  const from: PathSpot = atStart && tuck > 0 ? spotFromEnd(path, "tail", tuck) : { index: 0, t: 0 };
  const to: PathSpot = atEnd && tuck > 0 ? spotFromEnd(path, "tip", tuck) : { index: last, t: 1 };

  ctx.strokeStyle = clip.stroke!;
  ctx.lineWidth = clip.strokeWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  setDash(ctx, clip.dash, clip.strokeWidth);
  const line = pathBetween(path, from, to);
  ctx.beginPath();
  ctx.moveTo(line[0].from.x, line[0].from.y);
  for (const s of line) ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.to.x, s.to.y);
  ctx.stroke();

  // A head points the way the line comes into it: from where the line is a head's length back, to its end. On a tight
  // curve that keeps the head sitting on the line, where the line's direction at its very end would tip it off.
  const aim = (end: "tail" | "tip"): { at: Point; angle: number } => {
    const at = end === "tail" ? path[0].from : path[last].to;
    const back = spotPoint(path, spotFromEnd(path, end, headLength));
    return { at, angle: Math.atan2(at.y - back.y, at.x - back.x) };
  };
  if (atEnd) {
    const { at, angle } = aim("tip");
    drawHead(ctx, clip, at, angle, headLength);
  }
  if (atStart) {
    const { at, angle } = aim("tail");
    drawHead(ctx, clip, at, angle, headLength);
  }
}

// Draws a shape centred on the context's origin, in its own units: the caller has already moved, turned and scaled.
export function drawShape(ctx: Ctx2D, clip: ShapeClip): void {
  if (clip.shape === "arrow") drawArrow(ctx, clip);
  else drawBox(ctx, clip);
}
