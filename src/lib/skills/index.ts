import { SKILL_MD, SKILL_NAME, TOPICS, type SkillTopic, type SkillTopicId } from "./library.generated";
import { zipFiles } from "./zip";

// The skill's name, description and SKILL.md, and the shape of a topic, as the generated module has them.
export { SKILL_DESCRIPTION, SKILL_MD, SKILL_NAME, type SkillTopic, type SkillTopicId } from "./library.generated";

// Every topic of the video skill, in the order SKILL.md lists them.
export const SKILL_TOPICS: readonly SkillTopic[] = TOPICS;

// The topics' ids, in the same order: what get_editing_guide takes as its topic.
export const TOPIC_IDS: readonly SkillTopicId[] = TOPICS.map((topic) => topic.id);

// One topic by its id, or undefined when the skill has no topic of that name.
export function skillTopic(id: string): SkillTopic | undefined {
  return TOPICS.find((topic) => topic.id === id);
}

// When to read a topic, in a few words: its "Read this when …" line up to the first colon, as "When …".
function whenToRead(summary: string): string {
  const rest = summary.replace(/^Read this /, "");
  const colon = rest.indexOf(": ");
  const short = (colon < 0 ? rest : rest.slice(0, colon)).replace(/\.$/, "");
  return `${short.charAt(0).toUpperCase()}${short.slice(1)}.`;
}

// The guide's index of the skill: one line per topic, "- <id>: <title>. When …".
export function skillIndexLines(): string[] {
  return TOPICS.map((topic) => `- ${topic.id}: ${topic.title}. ${whenToRead(topic.summary)}`);
}

// The skill's files as an installed copy lays them out: <name>/SKILL.md, then <name>/references/<id>.md in topic order.
export function skillFiles(): { path: string; text: string }[] {
  return [
    { path: `${SKILL_NAME}/SKILL.md`, text: SKILL_MD },
    ...TOPICS.map((topic) => ({ path: `${SKILL_NAME}/references/${topic.id}.md`, text: topic.body })),
  ];
}

// The skill as one zip to download and unzip into an agent's skills folder, or upload to Claude.
export function skillArchive(): Uint8Array<ArrayBuffer> {
  return zipFiles(skillFiles().map((file) => ({ path: file.path, data: file.text })));
}
