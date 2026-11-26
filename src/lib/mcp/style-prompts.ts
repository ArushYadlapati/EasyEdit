import { escapeQuoted } from "@/lib/timeline";
import { oneLine } from "./one-line";

// The two style prompts: canned requests a person can start a conversation with (a slash command in some agents).
// Each is written as the person asking, and walks the agent through the work one step at a time. What the person typed
// into an argument is quoted and kept on its line.

const quoted = (text: string) => `"${escapeQuoted(oneLine(text.trim()))}"`;

// The links a person typed into learn-my-style, split at commas, spaces and new lines, each once.
export function promptLinks(links: string | undefined): string[] {
  return [...new Set((links ?? "").split(/[\s,]+/).filter((link) => link !== ""))];
}

// learn-my-style: read the space's style and what it learns from, ask at most two questions, propose a style, and save
// it with save_style once the person agrees, adding any links they gave.
export function learnMyStylePrompt(space: string, links?: string): string {
  const given = promptLinks(links);
  const steps = [
    `Call get_editing_guide with topic "style" and space ${quoted(space)}. Read what's saved, the facts for each video, link and past project, and the frame sheets if you can see pictures.`,
    ...(given.length > 0 ? [`I'd also like it to learn from these links: ${given.map(quoted).join(", ")}. You'll add them when you save.`] : []),
    "Ask me at most two questions, only about things the facts and frames can't tell you.",
    "Propose a style in a few short lines: a summary, the fields you'd fill in, and any notes. Leave out what the facts don't back up.",
    `Once I say yes, save it with save_style${given.length > 0 ? ", with the links in add_links" : ""}. Then tell me what you saved and give me the Style page link.`,
  ];
  return [
    `Please learn my video style for the space ${quoted(space)} and save it.`,
    "",
    ...steps.map((step, i) => `${i + 1}. ${step}`),
    "",
    "Don't save anything before I agree.",
  ].join("\n");
}

// edit-in-my-style: read the guide with the space (which ends with its style), read the project, plan an edit that
// follows the style, say the plan in three bullets, then make it one change at a time.
export function editInMyStylePrompt(space: string, project?: string): string {
  const which =
    project !== undefined && project.trim() !== ""
      ? `the project ${quoted(project)}`
      : "my most recent project in that space (list_projects shows them)";
  return [
    `Please edit a video in my ${quoted(space)} style.`,
    "",
    `1. Call get_editing_guide with space ${quoted(space)}, and read it through to "This space's style" at the end.`,
    `2. Read ${which} with get_project.`,
    "3. Plan an edit that follows the style: shot lengths and pace, the opening, captions, on-screen text, music, transitions and the look.",
    "4. Tell me the plan in three short bullets.",
    "5. Then make it one change at a time, and give me the editor link when you're done.",
  ].join("\n");
}
