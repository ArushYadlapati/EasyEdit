import { arrowAngle, arrowLook, arrowPoint } from "@/lib/timeline/shapes";
import type { ShapeClip, ShapeDash } from "@/lib/timeline/types";
import type { Ctx2D } from "./compositor";

type Point = { x: number; y: number };

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

function drawBox(ctx: Ctx2D, clip: ShapeClip): void {
  const { width: w, height: h } = clip;
  if (clip.shape === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
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
    ctx.lineJoin = clip.shape === "rect" && !clip.radius ? "miter" : "round";
    ctx.lineCap = "butt";
    setDash(ctx, clip.dash, clip.strokeWidth);
    ctx.stroke();
  }
}

// The part of the arrow's curve from t0 to t1, as a quadratic of its own: the same start and end, and a control point
// along the tangent at t0.
function curveBetween(clip: ShapeClip, t0: number, t1: number): { from: Point; control: Point; to: Point } {
  const from = arrowPoint(clip, t0);
  const to = arrowPoint(clip, t1);
  const a = arrowAngle(clip, t0);
  // The tangent's length at t0: the derivative of the centred quadratic.
  const c = 2 * arrowLook(clip).bend * clip.width;
  const speed = Math.hypot(clip.width, 2 * (1 - 2 * t0) * c);
  const reach = ((t1 - t0) / 2) * speed;
  return { from, control: { x: from.x + Math.cos(a) * reach, y: from.y + Math.sin(a) * reach }, to };
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
  const length = clip.width;
  const atEnd = look.heads === "end" || look.heads === "both";
  const atStart = look.heads === "start" || look.heads === "both";
  // A head never takes more than 45% of the line, so both heads on a short arrow still leave a line between them.
  const headLength = Math.min(look.headSize * clip.strokeWidth, length * 0.45);
  // A filled head covers the line's end, so the line stops just inside the head instead of poking out of its tip.
  const tuck = look.head === "triangle" ? (headLength * 0.8) / length : 0;
  const t0 = atStart ? tuck : 0;
  const t1 = atEnd ? 1 - tuck : 1;

  ctx.strokeStyle = clip.stroke!;
  ctx.lineWidth = clip.strokeWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  setDash(ctx, clip.dash, clip.strokeWidth);
  const { from, control, to } = curveBetween(clip, t0, t1);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
  ctx.stroke();

  if (atEnd) drawHead(ctx, clip, arrowPoint(clip, 1), arrowAngle(clip, 1), headLength);
  if (atStart) drawHead(ctx, clip, arrowPoint(clip, 0), arrowAngle(clip, 0) + Math.PI, headLength);
}

// Draws a shape centred on the context's origin, in its own units: the caller has already moved, turned and scaled.
export function drawShape(ctx: Ctx2D, clip: ShapeClip): void {
  if (clip.shape === "arrow") drawArrow(ctx, clip);
  else drawBox(ctx, clip);
}
