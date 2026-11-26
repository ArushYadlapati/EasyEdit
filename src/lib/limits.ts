export const LIMITS = {
  projectNameChars: 100,
  textClipChars: 2000,
  nestNameChars: 80,
  textSpansPerClip: 40, // stretches of one text clip with a look of their own
  trackNameChars: 100,
  slotHintChars: 200,
  tracksPerProject: 20,
  guidesPerProject: 50,
  markersPerProject: 200,
  markerNameChars: 80,
  clipsPerTrack: 1000,
  clipsPerNest: 200, // clips inside one nest, over all its tracks
  keyframesPerProperty: 100,
  shapeStrokeMax: 200, // a shape's outline or an arrow's line, in project pixels
  shapeSideMax: 16_384, // a shape's width, height or an arrow's length, in project pixels
  arrowPoints: 12, // the points an arrow's line passes through between its tail and its tip
  arrowPointReach: 10, // how far from an arrow's middle one of them may sit, in arrow lengths
  effectFramesMax: 600, // one transition or text animation, in frames
  curvePoints: 16, // the points one colour curve passes through
  lutsPerProject: 8, // colour look-up tables kept in one project, about 20 KB each
  lutSize: 17, // the steps along each colour of a kept look-up table
  lutNameChars: 60,
  docBytes: 2 * 1024 * 1024,
  opsPerRequest: 500,
  opsPageDefault: 100,
  opsPageMax: 500,
  opLogRowBytes: 1024 * 1024, // one op-log row: its ops plus its inverse, as UTF-8 JSON
  opsPageBytes: 2 * 1024 * 1024, // one page of the op log; a single larger entry is still sent alone
  connectorReadChars: 16_000, // one page of a read
  connectorEchoChars: 6_000, // the project text attached to a write or a conflict
  connectorListPage: 50, // projects per list_projects page
  connectorConflictEntries: 10, // unseen changes listed in a conflict
  connectorTextItems: 20, // text clips per add_text call
  connectorWritesPerMinute: 30, // changes one member's Claude may make in a minute
  connectorBytesPerDay: 10 * 1024 * 1024, // change data one member's Claude may store in a day
  connectorProjectsPerDay: 50, // projects one member's Claude may create in a day
  appEditBytesPerDay: 20 * 1024 * 1024, // edit data one person may store through the app in a day
  appEditsPerMinute: 600, // changes one person may save through the app in a minute
  appProjectsPerDay: 25, // projects one person may create in a day
  appUploadsPerDay: 500, // uploads one person may start in a day
  templatesPerSpace: 100, // saved templates in one space; the built-in starters do not count
  templateDescriptionChars: 300,
  templateInstructionsChars: 2000,
  foldersPerSpace: 200, // folders in one space, in total
  connectorNewIdLines: 50, // new ids listed after a write; the rest are in the project
  mediaFileBytes: 2 * 1024 * 1024 * 1024, // one uploaded file
  mediaChunkBytes: 8 * 1024 * 1024, // one piece of an upload; Drive needs a multiple of 256 KiB
  mediaParallelUploads: 2, // uploads running at once in one tab
  mediaPendingPerMember: 20, // unfinished uploads one member may have
  mediaPendingMaxAgeMs: 7 * 24 * 60 * 60 * 1000, // an unfinished upload older than this is dropped
  mediaNameChars: 120,
  mediaEventChars: 80,
  mediaListMax: 2000, // assets sent to an editor
  mediaIdsPerRequest: 200, // asset ids one list request may name
  mediaPosterBytes: 1024 * 1024, // one still picture
  mediaDirectPlayBytes: 200 * 1024 * 1024, // an original this small may be played when it has no preview copy
  mediaPreviewWaitMs: 2 * 60 * 60_000, // a preview copy still not made this long after the original was ready is shown as failed
  mediaCacheBytes: 2 * 1024 * 1024 * 1024, // playback files kept in the browser
  mediaReadTokenMinSeconds: 600, // a read token handed to a browser has at least this long left
  connectorAssetsPage: 50, // assets per list_assets page
  connectorMediaItems: 20, // clips per add_media call
  teamNameChars: 60, // a team's name
  teamsPerDay: 10, // teams one person may create in 24 hours
  teamMembers: 100, // people in one team, counting invites still waiting
  teamPendingInvites: 50, // invites waiting for an answer in one team
  socialTitleChars: 100, // a posted video's title; YouTube's own limit
  socialDescriptionBytes: 5000, // a posted video's description, as UTF-8; YouTube's own limit
  socialPostsPerSpacePerDay: 10, // videos one space may post in 24 hours; the site shares one daily allowance at YouTube
  socialFileBytes: 8 * 1024 * 1024 * 1024, // one posted video
  frameSideMin: 16, // a custom size, each side in pixels
  frameSideMax: 4096,
  frameAreaMax: 3840 * 2160, // a custom size; 8,294,400 is the area of 4K
  folderNameChars: 60,
  dashboardRecent: 6, // projects in your Recent list on the dashboard
  thumbnailBytes: 300 * 1024, // one project's dashboard picture, a JPEG
  presenceClipIds: 100, // clips of one tab's selection shown to teammates; a bigger selection shows its first 100 (sorted)
  presenceIdChars: 64, // a clip or track id longer than this is not shown to teammates
  presenceBodyBytes: 16 * 1024, // a check's body; a bigger one is checked without its selection
  presencePeers: 20, // other people listed back to one tab
  presenceTabsPerPerson: 5, // one person's rows kept per project; their oldest other tabs go first
  presenceRefreshMs: 15_000, // an unchanged selection is written again at most this often
  presenceTtlMs: 50_000, // a tab not heard from for this long is no longer shown
  presenceKeepMs: 10 * 60_000, // rows this old are deleted by the next check from anyone
  moveAbandonAfterMs: 24 * 60 * 60 * 1000, // an unfinished move this old is dropped by the next move into the same space
  presenceSweepRows: 50, // rows one check deletes at most
  captionWordChars: 80, // one caption word, in characters
  captionWordsPerFile: 10_000, // words kept for one media file
  captionFilesPerProject: 50, // media files with words kept in one project
  captionAudioMinutes: 60, // the longest sound one auto-captions run takes
} as const;

export type Limits = { readonly [K in keyof typeof LIMITS]: number };
