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

// When to read each topic, in a few words, for the guide's index. The topics' own "Read this when …" lines run long,
// and the guide is read before every edit, so these keep each index line to about 90 characters. A new topic needs a
// line here before the code builds.
const WHEN_TO_READ: Record<SkillTopicId, string> = {
  hooks: "When you shape the first 1–3 seconds of a short video.",
  pacing: "When you set shot lengths, tighten talking or cut on a beat.",
  captions: "When you turn on, style, place or fix captions.",
  "on-screen-text": "When you add or restyle words on screen.",
  "b-roll": "When you lay other footage over someone talking.",
  "music-and-sound": "When you add music, set levels or clean up sound.",
  "transitions-and-motion": "When you add transitions or zooms.",
  "color-and-looks": "When you change how footage looks or match clips.",
  "story-shapes": "When you plan which beats go where, short or long.",
  platforms: "When you fit a video to its platform.",
  "your-style": "When you edit for a space with a saved Style.",
  "learn-a-style": "When you learn someone's style and save it.",
  accessibility: "When you check a video works for everyone.",
  "final-check": "When the edit is done and needs a last pass.",
};

// The guide's index of the skill: one line per topic, "- <id>: <title>. When …".
export function skillIndexLines(): string[] {
  return TOPICS.map((topic) => `- ${topic.id}: ${topic.title}. ${WHEN_TO_READ[topic.id]}`);
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
