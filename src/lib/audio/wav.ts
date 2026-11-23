// Sound written as a WAV file: 16-bit samples, the plainest format every decoder reads. Pure.

// sides: one array of samples per channel, each from −1 to 1; a shorter one is silent past its end.
export function encodeWav(sides: readonly Float32Array[], sampleRate: number): ArrayBuffer {
  const channels = Math.max(1, sides.length);
  const frames = Math.max(0, ...sides.map((side) => side.length));
  const dataBytes = frames * channels * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // the format part's length
  view.setUint16(20, 1, true); // plain samples
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // bytes a second
  view.setUint16(32, channels * 2, true); // bytes a frame
  view.setUint16(34, 16, true); // bits a sample
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const x = Math.max(-1, Math.min(1, sides[c]?.[i] ?? 0));
      view.setInt16(at, Math.round(x < 0 ? x * 32768 : x * 32767), true);
      at += 2;
    }
  }
  return buffer;
}
