"use client";

import { useEffect, useRef, useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { LEVELS, glow, histogram, vectorPlace, vectorscope, waveform } from "@/lib/color/scopes";
import { frameTapOf } from "@/lib/editor/frame-tap";
import { useEditorStore } from "./context";

export type ScopeKind = "histogram" | "waveform" | "vectorscope";
const KINDS: { value: ScopeKind; label: string }[] = [
  { value: "histogram", label: "Histogram" },
  { value: "waveform", label: "Waveform" },
  { value: "vectorscope", label: "Vectorscope" },
];

// The frame is read at this size: plenty for counting, and quick enough to do as the playhead moves.
const READ = { width: 256, height: 144 };
const SCOPE = { width: 256, height: 128 }; // the scope's own pixels
const REDRAW_MS = 100; // at most ten times a second

// The six colours a vectorscope marks, where a pure one lands.
const TARGETS: [string, number, number, number][] = [["R", 255, 0, 0], ["Y", 255, 255, 0], ["G", 0, 255, 0], ["C", 0, 255, 255], ["B", 0, 0, 255], ["M", 255, 0, 255]];

function drawHistogram(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray) {
  const { width, height } = SCOPE;
  const h = histogram(data);
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  const bars = (counts: Uint32Array, color: string) => {
    ctx.fillStyle = color;
    for (let v = 0; v < LEVELS; v++) {
      const tall = Math.min(1, counts[v] / h.most) * height;
      if (tall > 0) ctx.fillRect((v / LEVELS) * width, height - tall, width / LEVELS, tall);
    }
  };
  bars(h.r, "rgb(190 40 40)");
  bars(h.g, "rgb(40 170 40)");
  bars(h.b, "rgb(50 70 210)");
  ctx.globalCompositeOperation = "source-over";
}

function drawWaveform(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray) {
  const { width, height } = SCOPE;
  const w = waveform(data, READ.width, READ.height, width);
  const out = ctx.createImageData(width, height);
  for (let x = 0; x < width; x++) {
    for (let level = 0; level < LEVELS; level++) {
      const count = w.counts[x * LEVELS + level];
      if (count === 0) continue;
      const y = height - 1 - Math.floor((level / LEVELS) * height);
      const i = (y * width + x) * 4;
      const lit = Math.max(out.data[i + 1], Math.round(70 + 185 * glow(count, w.most)));
      out.data[i] = lit * 0.75;
      out.data[i + 1] = lit;
      out.data[i + 2] = lit * 0.75;
      out.data[i + 3] = 255;
    }
  }
  ctx.clearRect(0, 0, width, height);
  ctx.putImageData(out, 0, 0);
  // Guides at a quarter, half and three quarters of full brightness.
  ctx.fillStyle = "rgb(255 255 255 / 0.18)";
  for (const share of [0.25, 0.5, 0.75]) ctx.fillRect(0, Math.round(height * share), width, 1);
}

function drawVectorscope(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray) {
  const { width, height } = SCOPE;
  const size = height;
  const left = (width - size) / 2;
  const v = vectorscope(data, size);
  const out = ctx.createImageData(size, size);
  for (let i = 0; i < v.counts.length; i++) {
    if (v.counts[i] === 0) continue;
    const lit = Math.round(80 + 175 * glow(v.counts[i], v.most));
    out.data[i * 4] = lit;
    out.data[i * 4 + 1] = lit;
    out.data[i * 4 + 2] = lit;
    out.data[i * 4 + 3] = 255;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.putImageData(out, left, 0);
  ctx.strokeStyle = "rgb(255 255 255 / 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(left + size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.moveTo(left + size / 2, 2);
  ctx.lineTo(left + size / 2, size - 2);
  ctx.moveTo(left + 2, size / 2);
  ctx.lineTo(left + size - 2, size / 2);
  ctx.stroke();
  ctx.font = "9px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [name, r, g, b] of TARGETS) {
    // Three quarters of the way out, where a colour at 75% of full strength lands.
    const at = vectorPlace(r * 0.75, g * 0.75, b * 0.75);
    ctx.fillStyle = `rgb(${r} ${g} ${b})`;
    ctx.fillText(name, left + at.x * size, at.y * size);
  }
}

const DRAW: Record<ScopeKind, (ctx: CanvasRenderingContext2D, data: Uint8ClampedArray) => void> = { histogram: drawHistogram, waveform: drawWaveform, vectorscope: drawVectorscope };

const SAYS: Record<ScopeKind, string> = {
  histogram: "How many pixels sit at each brightness, dark on the left: red, green and blue.",
  waveform: "Brightness across the frame: left is left, up is brighter.",
  vectorscope: "Color without brightness: grey is the middle, stronger colors sit further out.",
};

// The preview's frame as a scope, redrawn as the preview is. It reads the frame small, so it keeps up with a drag
// on a wheel or a curve.
export function Scopes() {
  const store = useEditorStore();
  const [kind, setKind] = useState<ScopeKind>("histogram");
  const shown = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const tap = frameTapOf(store);
    const reader = typeof document === "undefined" ? null : document.createElement("canvas");
    if (reader) Object.assign(reader, READ);
    const read = reader?.getContext("2d", { willReadFrequently: true }) ?? null;
    let last = 0;
    let waiting: ReturnType<typeof setTimeout> | null = null;
    const draw = () => {
      waiting = null;
      last = Date.now();
      const source = tap.canvas();
      const ctx = shown.current?.getContext("2d");
      if (!source || !read || !ctx) return;
      try {
        read.drawImage(source, 0, 0, READ.width, READ.height);
        DRAW[kind](ctx, read.getImageData(0, 0, READ.width, READ.height).data);
      } catch {
        // A frame that cannot be read (a picture from elsewhere taints the canvas) leaves the scope as it was.
      }
    };
    const ask = () => {
      if (waiting !== null) return;
      waiting = setTimeout(draw, Math.max(0, REDRAW_MS - (Date.now() - last)));
    };
    ask();
    const stop = tap.subscribe(ask);
    return () => {
      stop();
      if (waiting !== null) clearTimeout(waiting);
    };
  }, [store, kind]);

  return (
    <div className="flex flex-col gap-2">
      <Segmented<ScopeKind> label="Scope" value={kind} options={KINDS} onChange={setKind} />
      <canvas ref={shown} role="img" aria-label={`${KINDS.find((k) => k.value === kind)!.label} of the frame in the preview`} width={SCOPE.width} height={SCOPE.height} className="w-full rounded-md border border-ed-line bg-black" />
      <p className="text-[11px] leading-4 text-ed-muted">{SAYS[kind]}</p>
    </div>
  );
}
