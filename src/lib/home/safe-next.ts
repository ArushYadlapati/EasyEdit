// Where sign-in may send a person afterwards (`/login?next=…`): only an address on this site, written as a path.
// Anything else (another site, `//host`, a backslash that some browsers read as a slash, a scheme, an address of the
// sign-in server's own API, or something too long to be one of ours) is no address at all, and sign-in goes on to the
// dashboard as before.
const MAX_NEXT_CHARS = 512;
const BASE = "https://easyedit.invalid";

export function safeNext(value: string | string[] | undefined | null): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_NEXT_CHARS) return null;
  if (!text.startsWith("/") || text.startsWith("//") || text.includes("\\")) return null;
  // Control characters and spaces: browsers drop some of them, which can turn "/\t/host" into "//host".
  if (/[\u0000- \u007f]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (url.pathname === "/login" || url.pathname.startsWith("/api/")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

// The sign-in page's address that carries `next` on.
export function loginHref(next: string | null): string {
  return next ? `/login?${new URLSearchParams({ next }).toString()}` : "/login";
}
