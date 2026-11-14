// Any channel count to stereo, by Web Audio's speaker rules: what a browser does when it plays the file on two speakers.

// Writes `frames` stereo frames into left and right from index `at`, from planes of any count:
// 1 → both sides; 2 → as is; 4 (L R SL SR) → 0.5(L+SL), 0.5(R+SR); 6 (L R C LFE SL SR) → L + √½(C+SL), R + √½(C+SR),
// the LFE dropped and nothing normalised; any other count → the first two.
export function downmixInto(
  planes: readonly Float32Array[],
  frames: number,
  left: Float32Array,
  right: Float32Array,
  at: number,
): void {
  if (planes.length === 1) {
    const [mono] = planes;
    for (let i = 0; i < frames; i++) left[at + i] = right[at + i] = mono[i];
    return;
  }
  if (planes.length === 4) {
    const [l, r, sl, sr] = planes;
    for (let i = 0; i < frames; i++) {
      left[at + i] = 0.5 * (l[i] + sl[i]);
      right[at + i] = 0.5 * (r[i] + sr[i]);
    }
    return;
  }
  if (planes.length === 6) {
    const [l, r, c, , sl, sr] = planes;
    for (let i = 0; i < frames; i++) {
      left[at + i] = l[i] + Math.SQRT1_2 * (c[i] + sl[i]);
      right[at + i] = r[i] + Math.SQRT1_2 * (c[i] + sr[i]);
    }
    return;
  }
  left.set(planes[0].subarray(0, frames), at);
  right.set(planes[1].subarray(0, frames), at);
}
