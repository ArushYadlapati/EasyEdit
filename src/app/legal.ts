// The terms and privacy pages share one reading layout.

// About 65 characters a line, so a long paragraph is easy to follow from the end of one line to the start of the next.
// The width is 32rem rather than 65ch: ch is the width of a zero, and Geist's zero is much wider than its average
// letter, so 65ch comes out at about 90 characters.
export const LEGAL_ARTICLE = "flex w-full max-w-lg flex-col gap-5 leading-relaxed text-pretty";

// The article's gap spaces paragraphs 20 px apart. A section heading takes twice that above it and 12 px below it, so
// it reads as the start of the section under it, not the end of the one above.
export const LEGAL_H2 = "mt-5 -mb-2 text-lg font-semibold tracking-tight text-balance";

// The link back to the home page, as the mark and the name. It is only as wide as its words, so the empty end of the
// row is not part of the link.
export const LEGAL_BACK = "flex w-fit items-center gap-2 text-sm text-foreground/70 underline underline-offset-4";
