// The words of the AI agents page and the welcome's agent step. What an agent can and can't do is read off the
// connector's tools (src/lib/mcp/server.ts): if a tool is added or taken away, these lines change with it.
export const AGENT_WORDS = {
  intro: "Connect Claude or ChatGPT, then ask it to make and edit your videos. It makes real changes on your timeline, and you can check and undo every one.",
  choose: "Connect an agent",
  chooseLabel: "Agent to connect",
  connected: "Connected",
  // The last step of a consumer agent's setup: requests the connector can carry out today.
  thenAsk: "Then ask it, for example:",
  asks: [
    "Make a 15-second Short called Summer trip, with the title Three days in Lisbon.",
    "Add my newest video from Media to Summer trip, and put the text Day one over its first three seconds.",
    "Undo the last change you made to Summer trip.",
  ],
  copyAsk: (n: number) => `Copy example ${n}`,
  canDoTitle: "What an agent can do here",
  canDo: [
    "It acts as you, in the space you choose. If you're in more than one, it asks which.",
    "It can make projects, put text and media you've uploaded on the timeline, trim, split and move clips, and fill templates.",
    "Every change it makes shows in the editor's Activity with its name on it. Undo it there like any other change.",
    "It can't delete projects, upload files, or change a space's members or storage.",
  ],
  addressLabel: "EasyEdit's address",
  copyAddress: "Copy EasyEdit's address",
  opensNewTab: "(opens in a new tab)",
  // Shown when the page, coming back into view, finds an agent that wasn't connected when it opened.
  justConnected: (name: string) => `${name} is connected. Go back to ${name} and ask it to make something.`,
  others: "Other agents and developer tools",
  othersIntro:
    "Claude Code, Cursor, VS Code, Codex, Gemini CLI, the OpenAI API and other apps connect over MCP, the standard way AI agents connect to apps like EasyEdit. They all use the same address.",
  serverAddress: "Server address",
  setUpOther: "Set up another agent",
  connectedTitle: "Connected agents",
  noneConnected: "No agents connected yet.",
  tokensTitle: "Access tokens",
  tokensIntro:
    "For agents and scripts that send a header instead of signing in. A token acts as you until you revoke it, so keep it secret, like a password.",
  // Tokens made here that nothing has used yet: listed with the tokens, not as connected agents.
  unusedTokens: "Not used yet",
} as const;
