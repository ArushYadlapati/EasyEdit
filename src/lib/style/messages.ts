import { LIMITS } from "@/lib/limits";

const kb = (bytes: number) => `${Math.round(bytes / 1000)} KB`;

// What a refused style change says, to the person on the Style page and to an agent.
export const STYLE_MESSAGES = {
  tooManyReferences: `A style learns from up to ${LIMITS.styleReferences} videos, links and projects. Remove one to add another.`,
  notAVideo: "Pick a video from this space's media.",
  notReady: "That video is still uploading. Add it once it's ready.",
  alreadyAdded: "Your style already learns from that one.",
  badLink: "Paste a link to a YouTube, Vimeo or TikTok video.",
  instagram: "Instagram doesn't let other apps read posts. Download your video from Instagram and upload it here instead.",
  tiktokShareLink: "That TikTok share link can't be read. Open it in a web browser, then paste the address from there, the one with /video/ in it.",
  linkUnreadable: "We couldn't read this link's details, but agents will still see it.",
  sheetTooBig: `The strip of frames came out bigger than ${kb(LIMITS.styleSheetBytes)}, so it wasn't saved. Try again.`,
  badAnalysis: "What we measured in that video didn't come through right, so it wasn't saved. Try again.",
  notesTooLong: `Notes can be up to ${LIMITS.styleNotesChars.toLocaleString("en-US")} characters.`,
  notAStyleChange: "That isn't a style change.",
  referenceGone: "That isn't in your style anymore.",
  projectGone: "That project isn't in this space anymore.",
} as const;
