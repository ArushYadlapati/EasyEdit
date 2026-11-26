// The preview's picture, for whoever wants to read it (the scopes). The preview says where its canvas is and tells of
// every draw; a reader is told too, and takes the pixels itself when it wants them. One per open editor, found by
// the editor's store so that nothing has to be handed down the tree.

export type FrameTap = {
  canvas(): CanvasImageSource | null;
  set(canvas: CanvasImageSource | null): void;
  drawn(): void; // the preview has drawn a frame
  subscribe(listener: () => void): () => void;
};

export function createFrameTap(): FrameTap {
  let canvas: CanvasImageSource | null = null;
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of listeners) listener();
  };
  return {
    canvas: () => canvas,
    set(next) {
      canvas = next;
      tell();
    },
    drawn: tell,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const taps = new WeakMap<object, FrameTap>();

export function frameTapOf(store: object): FrameTap {
  let tap = taps.get(store);
  if (!tap) taps.set(store, (tap = createFrameTap()));
  return tap;
}
