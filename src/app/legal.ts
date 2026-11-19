// The terms and privacy pages share one reading layout, inside the public site's frame (SitePage), which gives them the
// header with the way back home and the footer.

// The column sits in the middle of the window, with the site's own side margin on a phone.
export const LEGAL_MAIN = "flex flex-1 justify-center px-(--h-pad) pt-12 pb-24 sm:pt-20";

// About 65 characters a line, so a long paragraph is easy to follow from the end of one line to the start of the next.
// The width is 32rem rather than 65ch: ch is the width of a zero, and Geist's zero is much wider than its average
// letter, so 65ch comes out at about 90 characters. The text is 16 px (the site around it is 17 px).
export const LEGAL_ARTICLE = "flex w-full max-w-lg flex-col gap-5 text-base leading-relaxed text-pretty";

// The page's one heading, at the size of the site's other page titles (h-plainTitle in components/site/site.css), with
// a little more room under it than between paragraphs.
export const LEGAL_TITLE = "h-plainTitle mb-2";

// The article's gap spaces paragraphs 20 px apart. A section heading is half as big again as the text, and takes
// 28 px more above it (48 in all) and 8 px less below it (12), so it reads as the start of the section under it, not
// the end of the one above.
export const LEGAL_H2 = "mt-7 -mb-2 text-2xl leading-tight font-semibold tracking-[-0.02em] text-balance";
