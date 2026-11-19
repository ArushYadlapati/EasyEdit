// The terms and privacy pages share one reading layout, inside the public site's frame (SitePage), which gives them the
// header with the way back home and the footer.

// The list of the page's sections on the left and the text front and centre; on a narrow window the text alone (h-plain
// and h-legal in components/site/site.css).
export const LEGAL_MAIN = "h-plain h-legal";

// The text, front and centre and wide (h-legal in components/site/site.css sets its width): 18 px, so a long line
// still reads easily.
export const LEGAL_ARTICLE = "flex w-full flex-col gap-5 text-lg leading-relaxed text-pretty";

// The page's one heading, at the size of the site's other page titles (h-plainTitle in components/site/site.css), with
// a little more room under it than between paragraphs.
export const LEGAL_TITLE = "h-plainTitle mb-2";

// The article's gap spaces paragraphs 20 px apart. A section heading is about half as big again as the text (28 px), and
// takes 28 px more above it (48 in all) and 8 px less below it (12), so it reads as the start of the section under it,
// not the end of the one above.
export const LEGAL_H2 = "mt-7 -mb-2 text-[28px] leading-tight font-semibold tracking-[-0.02em] text-balance";
