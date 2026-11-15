// Personal spaces are not offered yet: until this is switched on, EasyEdit is for teams. Off, nobody is sent to their
// personal space, its page says it is coming soon, and AI agents start nothing there. What a person already made
// there stays reachable. A plain module, so pages on the server and the tools read the same switch.
export function personalSpacesOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PERSONAL_SPACES === "true";
}

// The words of the closed personal space: its page, and the tag beside it in My Spaces.
export const PERSONAL_SOON = {
  tag: "Soon",
  label: "coming soon", // the tag, as the link's name is read aloud: "Personal, coming soon"
  title: "Personal spaces are coming soon",
  text: "For now, EasyEdit is for teams. A space of your own, for projects only you can see, is on the way.",
  toTeam: (name: string) => `Go to ${name}`,
  noTeam: "You're not in a team yet. Ask a team's admin to add you.",
  noTeamCanCreate: "You're not in a team yet. Make one with Create a team, under My Spaces.",
  already: "Projects you already made here",
};
