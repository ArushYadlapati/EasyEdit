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
  // Picking videos from the space's YouTube channel.
  channelOff: "YouTube isn't set up on this server, so videos can't be added from a channel.",
  channelHidden: "EasyEdit can't see this channel's videos yet. An admin can connect the channel again in Settings, Socials, and leave every box ticked.",
  notOnChannel: "That video isn't on this space's YouTube channel.",
  channelUnreadable: "YouTube couldn't share this channel's videos just now. Try again in a little while.",
} as const;

// The Style page's own words, apart from refusals.
export const STYLE_WORDS = {
  // Where looking over one of the space's videos has got to, one step at a time. waiting: another video goes first.
  analyzing: {
    waiting: "Waiting its turn",
    shots: "Looking at the shots",
    listening: "Listening",
    saving: "Saving",
  },
  // Why a video couldn't be looked over. Kept with the video in the style and shown on its card, beside Try again.
  // tooLong says ANALYSIS_LIMITS.seconds (in types.ts) in hours; a test keeps the two alike.
  analysisFailed: {
    missing: "This video isn't in your media anymore.",
    notReady: "This video is still uploading. Try again once it's ready.",
    tooLong: "This video is longer than 4 hours, which is more than we can look at. Try a shorter one.",
    unreadable: "We couldn't open this video. Check your connection, then try again.",
    noPicture: "We couldn't see any frames in this video. Try uploading it again.",
    unknown: "Something went wrong while we looked at this video. Try again.",
  },
  // What we found in a video couldn't reach the server, so it wasn't saved. Shown on its card, beside Try again.
  analysisNotSaved: "We couldn't save what we found in this video. Check your connection, then try again.",

  // The page's opening line, for someone who can change the style and for someone who can only read it.
  intro: "Show AI agents how your videos look and feel. They read this before they edit for you.",
  introViewer: "How your videos look and feel. AI agents read this before they edit for you. Only editors can change it.",

  // "Learn from your videos": what the style learns from, and the ways to add to it. channelStale says
  // CHANNEL_FACTS_DAYS (in service.ts) in days; a test keeps the two alike.
  learn: {
    heading: "Learn from your videos",
    intro:
      "Add a few videos you've made. EasyEdit looks at the cuts, the words, the sound and the colors, and saves a strip of frames agents can look at. Your files stay in your storage.",
    introViewer: "The videos, links and past projects your style learns from.",
    addVideo: "Add a video",
    pasteLink: "Paste a link",
    pickProjects: "Pick past projects",
    fromChannel: "From your YouTube channel",
    empty: "No videos yet. Add one or two that feel most like you.",
    emptyViewer: "No videos yet.",
    remove: (title: string) => `Remove ${title}`,
    notLookedAt: "Not looked at yet.",
    notLookedAtViewer: "Not looked at yet. That happens when an editor opens this page.",
    tryAgain: "Try again",
    refresh: "Refresh",
    channelStale: "YouTube's details for this video were cleared after 30 days, as YouTube asks.",
  },

  // The Add a video dialog.
  video: {
    title: "Add a video",
    empty: "This space has no videos yet.",
    upload: "Upload a video",
    uploadsShowHere: "You can pick a new upload once it's ready.",
    noStorage: "To upload a video here, this space's storage needs setting up first.",
    uploading: "Uploading…",
    inStyle: "In your style",
    pick: (name: string) => `Add ${name}`,
  },

  // The box a link is pasted in.
  link: {
    label: "Video link",
    placeholder: "Paste a YouTube, Vimeo or TikTok link",
    hint: "We read the video's public title and picture, never the video itself. To learn from what's in it, upload your own copy.",
    add: "Add link",
    cancel: "Cancel",
    uploadInstead: "Upload a video instead",
  },

  // The Pick past projects dialog.
  projects: {
    title: "Pick past projects",
    intro: "EasyEdit counts the cuts, the text, the captions, the transitions and the music in each one.",
    empty: "This space has no projects yet.",
    edited: (ago: string) => `Edited ${ago}`,
    inStyle: "In your style",
    add: (count: number) => (count === 0 ? "Add projects" : count === 1 ? "Add 1 project" : `Add ${count} projects`),
    room: (left: number) => (left <= 0 ? "That's all your style has room for." : left === 1 ? "You can add 1 more." : `You can add ${left} more.`),
    adding: "Adding…",
  },

  // The From your YouTube channel dialog.
  channel: {
    title: "From your YouTube channel",
    loading: "Getting your channel's videos…",
    notConnected: "This space hasn't connected a YouTube channel yet.",
    connect: "Connect one in Socials",
    askAdmin: "An admin can connect one in Settings, Socials.",
    empty: "There are no videos on this channel yet.",
    newest: (channel: string) => `The newest videos on ${channel}.`,
    note: "We keep each video's public details from YouTube, never the video, and clear them after 30 days.",
    add: "Add",
    addLabel: (title: string) => `Add ${title}`,
    added: "Added",
  },

  // The Your style form.
  form: {
    heading: "Your style",
    fillIn: "Fill in from my videos",
    fillInFirst: "Add a video, link or project above first, then we'll fill in what we can.",
    fillInNothing: "Nothing new to fill in. Your videos don't say anything about the fields that are still empty.",
    filledSome: (count: number) => `Filled in ${count === 1 ? "1 field" : `${count} fields`} from your videos. Check them, then save.`,
    filledTag: "Filled in",
    lastChanged: (who: string | undefined, ago: string) => (who ? `Last changed by ${who}, ${ago}` : `Last changed ${ago}`),
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    clear: "Clear",
    clearLabel: (field: string) => `Clear ${field}`,
    notSet: "Not set",
    to: "to",
    seconds: "seconds",
    shortest: "Shortest, in seconds",
    longest: "Longest, in seconds",
    lengthProblem: (min: number, max: number) => `Use two numbers from ${min} to ${max.toLocaleString("en-US")}, the shorter one first.`,
    shotProblem: (min: number, max: number) => `Use a number of seconds from ${min} to ${max}.`,
    add: "Add",
    addTo: (list: string) => `Add to ${list}`,
    item: (list: string, n: number) => `${list}, item ${n}`,
    removeItem: (list: string, n: number) => `Remove item ${n} from ${list}`,
    listFull: "That's as many as this list holds.",
    alwaysPlaceholder: "For example: open on the best moment",
    neverPlaceholder: "For example: long intros",
    empty: "Nobody has filled in this space's style yet.",
  },

  // How a set field reads when it can only be looked at.
  values: {
    about: (seconds: string) => `About ${seconds} seconds`,
    range: (min: string, max: string) => `${min} to ${max} seconds`,
    on: "On",
    off: "Off",
    allCaps: "All caps",
  },

  // The line of facts on each reference's card.
  facts: {
    shots: (count: number, each: string) => (count === 1 ? "1 shot" : `${count} shots, about ${each} each`),
    talks: (perMinute: number) => `talks ${perMinute} words a minute`,
    noTalking: "no talking",
    providers: { youtube: "YouTube", vimeo: "Vimeo", tiktok: "TikTok", channel: "Your YouTube channel" },
    youtubeShort: "YouTube Short",
    project: "Project",
    transitions: (count: number) => (count === 1 ? "1 transition" : `${count} transitions`),
    noTransitions: "straight cuts",
    captions: "captions",
  },

  // "Try it": what to ask an agent once there is a style. A personal space has no name to give.
  tryIt: {
    heading: "Try it",
    intro: "Ask your agent:",
    line: (spaceName: string | null) =>
      spaceName === null ? "Edit my latest project in my personal style." : `Edit my latest project in the ${spaceName} style.`,
    copy: "Copy what to ask your agent",
  },

  // The Style card at the bottom of the editor's Brand kit tab: the style at a glance, and the way to the Style page.
  // A viewer can only look at the style there, so their link and empty line don't ask them to change it.
  card: {
    heading: "Style",
    field: (label: string, value: string) => `${label}: ${value}`,
    empty: "No style yet. Show AI agents how your videos look and feel.",
    emptyViewer: "No style yet.",
    edit: "Edit style",
    see: "See style",
  },
} as const;
