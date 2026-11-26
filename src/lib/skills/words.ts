// The words people see about the video skills, on the AI agents page. A plain module with no skill text in it, so a
// page can show these without loading the whole skill.

// The name the skill's zip saves as.
export const SKILL_ZIP_NAME = "easyedit-video.zip";

// Where the skill's zip is served. Public: no sign-in.
export const SKILL_ZIP_PATH = `/skills/${SKILL_ZIP_NAME}`;

// The Claude Code commands that add the plugin, which brings the skills and the EasyEdit connection together.
export const PLUGIN_COMMANDS = [
  { command: "/plugin marketplace add ArushYadlapati/EasyEdit", label: "First command", copyLabel: "Copy the first command" },
  { command: "/plugin install easyedit@easyedit", label: "Second command", copyLabel: "Copy the second command" },
] as const;

// The folder that Codex, Cursor, Gemini CLI and Copilot read skills from on someone's own computer.
export const AGENT_SKILLS_FOLDER = "~/.agents/skills";

// The "Video skills" section of the AI agents page.
export const SKILL_WORDS = {
  title: "Video skills",
  intro: "Skills teach AI agents how to make good videos: strong openings, pacing, captions, music, and how to follow your style.",
  connected: "Agents you connect here already have them. You can also add them yourself:",
  ways: "Other ways to add them",
  // The plugin's connection needs a sign-in before its tools work, and someone already set up from "Set up an agent"
  // would get EasyEdit twice: each command shown in code, between the words before and after it.
  claudeCode: {
    name: "Claude Code",
    text: "Run these two commands in Claude Code. They add the skills and connect EasyEdit.",
    signIn: { before: "Then run ", code: "/mcp", after: " in Claude Code, pick easyedit, choose Authenticate and sign in." },
    already: {
      before: "Already connected Claude Code with the steps above? Then it has the skills, so you can skip this. To use the plugin instead, first run ",
      code: "claude mcp remove easyedit",
      after: " in a terminal.",
    },
  },
  otherAgents: { name: "Codex, Cursor, Gemini CLI and Copilot", before: "Download the skill and unzip it into ", after: "." },
  claudeWeb: { name: "Claude on the web", text: "Upload the same file under Settings → Capabilities → Skills." },
  download: `Download ${SKILL_ZIP_NAME}`,
} as const;
