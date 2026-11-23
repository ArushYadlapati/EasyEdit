// Taking a colour out of a picture: a green screen. Pure, so the same pixels come out in the preview and the export.

export type ChromaKey = { color: string; tolerance: number; softness: number };

// A colour's two colour-difference numbers: what hue it is and how strong, with its brightness left out. A darker
// green is nearer the middle than a bright one, which is what the tolerance is there to take in.
function chromaOf(r: number, g: number, b: number): [number, number] {
  return [-0.169 * r - 0.331 * g + 0.5 * b, 0.5 * r - 0.419 * g - 0.081 * b];
}

const FULL = 180; // about the furthest apart two colours' colour-difference numbers get

// Makes the pixels near the key colour see-through, in place. data: RGBA bytes, as a canvas gives them. Within
// `tolerance` of the key colour a pixel goes fully; over the next `softness` it fades back in, so edges are not
// jagged. Both are shares of the furthest two colours can be apart.
export function keyOut(data: Uint8ClampedArray, key: ChromaKey): void {
  const n = parseInt(key.color.slice(1), 16);
  const [kb, kr] = chromaOf((n >> 16) & 255, (n >> 8) & 255, n & 255);
  const inner = key.tolerance * FULL;
  const outer = inner + Math.max(0.0001, key.softness * FULL);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const [cb, cr] = chromaOf(data[i], data[i + 1], data[i + 2]);
    const far = Math.hypot(cb - kb, cr - kr);
    if (far >= outer) continue;
    data[i + 3] = far <= inner ? 0 : Math.round(data[i + 3] * ((far - inner) / (outer - inner)));
  }
}

// What turning the green screen on starts from: pure green, with room for the duller, unevenly lit green of a real
// screen, and well short of skin, white and grey.
export const CHROMA_START: ChromaKey = { color: "#00ff00", tolerance: 0.4, softness: 0.1 };
