type HappyDOMWindow = {
  happyDOM: { setViewport(size: { width: number; height: number }): void; setURL(url: string): void };
};

// happy-dom's own controls on the test window, which the DOM types do not know: resizing the window (it fires
// "resize") and moving it to another address (so cookies for that path are kept).
export function happyDOM(): { setViewport(size: { width: number; height: number }): void; setURL(url: string): void } {
  return (window as unknown as HappyDOMWindow).happyDOM;
}
