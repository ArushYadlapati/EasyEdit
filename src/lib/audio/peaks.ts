// A sound boiled down to how loud it gets in each short stretch, for drawing its shape on the timeline. Pure.

export const PEAKS_PER_SECOND = 50;

// values: one per stretch, 0 (silence) to 255 (full scale), the loudest moment of any side in it.
export type Peaks = { perSecond: number; values: Uint8Array };

export function peaksOf(sides: readonly Float32Array[], sampleRate: number, perSecond = PEAKS_PER_SECOND): Peaks {
  const length = Math.max(0, ...sides.map((side) => side.length));
  const block = sampleRate / perSecond;
  const values = new Uint8Array(Math.ceil(length / block));
  for (let i = 0; i < values.length; i++) {
    const from = Math.floor(i * block);
    const to = Math.min(length, Math.floor((i + 1) * block));
    let peak = 0;
    for (const side of sides) {
      for (let s = from; s < to && s < side.length; s++) {
        const v = Math.abs(side[s]);
        if (v > peak) peak = v;
      }
    }
    values[i] = Math.min(255, Math.round(peak * 255));
  }
  return { perSecond, values };
}

// The sound between two moments of its file as `columns` bars, each 0 to 1: the loudest stretch its span covers, on a
// square-root scale so quiet speech still shows. `from` after `to` reads it backward. Outside the file is silence.
export function waveColumns(peaks: Peaks, fromSeconds: number, toSeconds: number, columns: number): number[] {
  const bars: number[] = [];
  const step = (toSeconds - fromSeconds) / Math.max(1, columns);
  for (let c = 0; c < columns; c++) {
    const a = fromSeconds + step * c;
    const b = a + step;
    const first = Math.max(0, Math.floor(Math.min(a, b) * peaks.perSecond));
    const last = Math.min(peaks.values.length, Math.max(first + 1, Math.ceil(Math.max(a, b) * peaks.perSecond)));
    let peak = 0;
    for (let i = first; i < last; i++) if (peaks.values[i] > peak) peak = peaks.values[i];
    bars.push(Math.sqrt(peak / 255));
  }
  return bars;
}
