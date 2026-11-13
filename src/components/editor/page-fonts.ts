// Reads CSS variables from the document element. The app's font variables never change once set, so a
// value is read once.
export function cachedCssVar(): (name: string) => string {
  const cache = new Map<string, string>();
  return (name) => {
    const known = cache.get(name);
    if (known !== undefined) return known;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    if (value.trim()) cache.set(name, value);
    return value;
  };
}

// Asks the page for each CSS font and settles once each has loaded or failed. It never rejects, and does nothing where
// the page has no document.fonts.
export async function loadFonts(fonts: Iterable<string>): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const load = async (font: string) => {
    try {
      await document.fonts.load(font);
    } catch {
      // the text is drawn in its fallback face
    }
  };
  await Promise.all(Array.from(fonts, load));
}
