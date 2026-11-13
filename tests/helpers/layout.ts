type HappyDOMWindow = {
  happyDOM: { setViewport(size: { width: number; height: number }): void; setURL(url: string): void };
};

// happy-dom's own controls on the test window, which the DOM types do not know: resizing the window (it fires
// "resize") and moving it to another address (so cookies for that path are kept).
export function happyDOM(): { setViewport(size: { width: number; height: number }): void; setURL(url: string): void } {
  return (window as unknown as HappyDOMWindow).happyDOM;
}

// A box on screen, for stubbing getBoundingClientRect where happy-dom does no layout.
export function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, x: left, top, y: top, width, height, right: left + width, bottom: top + height, toJSON() {} } as DOMRect;
}
