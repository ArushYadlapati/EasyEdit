// Any sample rate and any speed to the export's rate: a 32-tap Kaiser sinc read from a 256-phase table,
// streaming, with a bit-exact copy when there is nothing to convert.

// h(i / phases) for i in [0, zeros · phases), then one entry of 0: the last phase reads down to nothing at `zeros`,
// so a tap is continuous where it ends and a position a rounding error either side of a whole frame gives the same sample.
export type SincKernel = { zeros: number; phases: number; table: Float32Array };

// The zeroth-order modified Bessel function, by its power series, summed until a term is under 1e-12 of the sum.
function besselI0(x: number): number {
  const q = (x / 2) * (x / 2);
  let sum = 1;
  let term = 1;
  for (let k = 1; term >= 1e-12 * sum; k++) {
    term *= q / (k * k);
    sum += term;
  }
  return sum;
}

function sinc(u: number): number {
  return u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
}

// h(x) = rolloff · sinc(rolloff · x) · I0(beta · √(1 − (x / zeros)²)) / I0(beta): a sinc cut off at rolloff × Nyquist,
// tapered by a Kaiser curve over `zeros` crossings each side (still about 2e-5 at its edge, hence the table's closing 0).
export function sincKernel(zeros = 16, phases = 256, beta = 8.6, rolloff = 0.92): SincKernel {
  const end = zeros * phases;
  const table = new Float32Array(end + 1);
  const norm = besselI0(beta);
  for (let i = 0; i < end; i++) {
    const x = i / phases;
    const kaiser = besselI0(beta * Math.sqrt(Math.max(0, 1 - (x / zeros) * (x / zeros)))) / norm;
    table[i] = rolloff * sinc(rolloff * x) * kaiser;
  }
  return { zeros, phases, table };
}

// Source frames read on each side of a position: the kernel widens by step when it reads faster than one frame a sample.
export function reach(step: number, kernel: SincKernel): number {
  return Math.ceil(kernel.zeros / Math.min(1, 1 / step));
}

// A whole offset at one frame a sample lands on the source's own samples: a copy, not a filter.
export function isBypass(p0: number, step: number): boolean {
  return step === 1 && Number.isInteger(p0);
}

// out[i] = the source at p0 + i·step (source frames), for i in [0, count); i·step from the integer i, never added up.
// read(index) gives a source frame; it is called only for indices within reach(step) of each position.
export function resampleInto(
  out: Float32Array,
  count: number,
  read: (index: number) => number,
  p0: number,
  step: number,
  kernel: SincKernel,
): void {
  if (isBypass(p0, step)) {
    for (let i = 0; i < count; i++) out[i] = read(p0 + i);
    return;
  }
  const { phases, table } = kernel;
  const end = kernel.zeros * phases;
  const scale = Math.min(1, 1 / step);
  const r = reach(step, kernel);
  for (let i = 0; i < count; i++) {
    const p = p0 + i * step;
    const n = Math.floor(p);
    let sum = 0;
    for (let j = n - r + 1; j <= n + r; j++) {
      // tap((j − p) · scale): the table at |x| · phases, read between neighbours; nothing at or past `zeros`.
      const at = Math.abs((j - p) * scale) * phases;
      if (at >= end) continue;
      const k = Math.floor(at);
      const t = at - k;
      sum += read(j) * (table[k] + (table[k + 1] - table[k]) * t);
    }
    out[i] = scale * sum;
  }
}
