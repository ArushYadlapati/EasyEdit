// Makes src/lib/skills/library.generated.ts, the video skill as the app serves it: SKILL.md and every topic file of
// plugins/easyedit/skills/easyedit-video, as strings. The Markdown files are the one source, so an agent that installs
// the skill and an agent that reads it over the connector get the same words.
// Run it after changing a skill file: `node scripts/make-skills.mjs`. A test fails while the file is out of date.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// The skill's folder, which is also what the Claude Code plugin installs.
export const SKILL_DIR = join(root, "plugins", "easyedit", "skills", "easyedit-video");
// The module the script writes.
export const TARGET = join(root, "src", "lib", "skills", "library.generated.ts");
const HEADER =
  "// Made by scripts/make-skills.mjs from plugins/easyedit/skills/easyedit-video (SKILL.md and references/*.md).\n" +
  "// Don't edit it by hand: change those files, then run `node scripts/make-skills.mjs`.";

// A topic is listed in SKILL.md as "- `references/<id>.md` — Read this when …".
const LISTED = /^- `references\/([a-z0-9-]+)\.md`/gm;
const SUMMARY_START = "Read this when ";

function fail(message) {
  throw new Error(`make-skills: ${message}`);
}

// The front matter's "key: value" lines, in order. The skill keeps to plain one-line values, so no YAML parser is needed.
export function frontMatter(skill) {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  if (!block) fail("SKILL.md must start with front matter between two --- lines.");
  return block[1].split("\n").map((line) => {
    const colon = line.indexOf(":");
    if (colon < 1) fail(`front matter line "${line}" is not "key: value".`);
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  });
}

// A string as a template literal, so the generated file reads like the Markdown it came from.
const literal = (text) => "`" + text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";

// The generated module, from SKILL.md's text and each topic file's text by id. Pure: the test calls it on what is on disk.
export function build({ skill, topics }) {
  const fields = Object.fromEntries(frontMatter(skill));
  if (!fields.name) fail("SKILL.md's front matter has no name.");
  if (!fields.description) fail("SKILL.md's front matter has no description.");
  const order = [...skill.matchAll(LISTED)].map((m) => m[1]);
  for (const id of order) if (!(id in topics)) fail(`SKILL.md lists references/${id}.md, which is not there.`);
  for (const id of Object.keys(topics)) if (!order.includes(id)) fail(`references/${id}.md is not listed in SKILL.md.`);
  if (new Set(order).size !== order.length) fail("SKILL.md lists a topic twice.");

  const entries = order.map((id) => {
    const body = topics[id];
    const lines = body.split("\n");
    if (!lines[0].startsWith("# ")) fail(`references/${id}.md must start with "# Title".`);
    if (lines[1] !== "" || !lines[2]?.startsWith(SUMMARY_START)) fail(`references/${id}.md's second line must be blank and its third must start with "${SUMMARY_START}".`);
    const title = lines[0].slice(2).trim();
    const summary = lines[2].trim();
    return `  {\n    id: ${JSON.stringify(id)},\n    title: ${JSON.stringify(title)},\n    summary: ${JSON.stringify(summary)},\n    body: ${literal(body)},\n  },\n`;
  });

  return [
    HEADER,
    "",
    "// The skill's folder name, which is also its name in the front matter.",
    `export const SKILL_NAME = ${JSON.stringify(fields.name)};`,
    "",
    "// When an agent should reach for the skill, from the front matter.",
    `export const SKILL_DESCRIPTION = ${JSON.stringify(fields.description)};`,
    "",
    "// The topics' ids, in SKILL.md's order.",
    `export type SkillTopicId = ${order.map((id) => JSON.stringify(id)).join(" | ")};`,
    "",
    "// One topic file: its id (the file name without .md), its title, its \"Read this when …\" line and the whole file.",
    "export type SkillTopic = { readonly id: SkillTopicId; readonly title: string; readonly summary: string; readonly body: string };",
    "",
    "// SKILL.md as it is on disk, front matter and all.",
    `export const SKILL_MD = ${literal(skill)};`,
    "",
    "// Every topic, in SKILL.md's order.",
    `export const TOPICS: readonly SkillTopic[] = [\n${entries.join("")}];`,
    "",
  ].join("\n");
}

// The skill's files as they are on disk: SKILL.md, and each references/<id>.md by id.
export function readSkill(dir = SKILL_DIR) {
  const skill = readFileSync(join(dir, "SKILL.md"), "utf8");
  const topics = {};
  for (const file of readdirSync(join(dir, "references")).sort()) {
    if (file.endsWith(".md")) topics[file.slice(0, -3)] = readFileSync(join(dir, "references", file), "utf8");
  }
  return { skill, topics };
}

// The module the files on disk make.
export function made(dir = SKILL_DIR) {
  return build(readSkill(dir));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, made());
  console.log(`wrote ${TARGET}`);
}
