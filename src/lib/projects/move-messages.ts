// What a person is told about moving a project between spaces. No imports: browser code uses this file too.
export const MOVE_MESSAGES = {
  sameSpace: "This project is already in that space.",
  cantEditThere: (space: string) => `You can only move a project to a space where you can edit. You can't edit in ${space}.`,
  noStorage: (space: string) => `${space} has no storage yet. Set it up, then move the project.`,
  noStorageAskAdmin: (space: string) => `${space} has no storage yet. Ask an admin of ${space} to set it up.`,
  storageBroken: (space: string) => `${space}'s Google Drive needs reconnecting before anything can be copied into it.`,
  notReady: (name: string) => `"${name}" hasn't finished uploading yet. Try again once it has.`,
  notInProject: "That media is not used by this project.",
  gone: "This move was canceled or has already finished.",
  copiesMissing: "Some media was added while the project was copying.",
  moved: "This project was moved to another space. Open it there to keep editing.",
} as const;
