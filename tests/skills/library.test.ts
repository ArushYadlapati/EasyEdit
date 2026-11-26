import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LIMITS } from "@/lib/limits";
import { registerTools } from "@/lib/mcp/server";
import { SKILL_DESCRIPTION, SKILL_MD, SKILL_NAME, SKILL_TOPICS, TOPIC_IDS, skillFiles, skillTopic } from "@/lib/skills";
import { CAPTION_POSITION_Y } from "@/lib/style/caption-position";
import { AGENT_SHEETS } from "@/lib/style/service";
import { suggestStyle } from "@/lib/style/suggest";
import { STYLE_PROFILE_KEYS, type ProjectAnalysis } from "@/lib/style/types";
import { FormatId, OpInput } from "@/lib/timeline";
import { USE_CLIENT_AT_TOP, importsOf, sources } from "../helpers/sources";

type Skill = { skill: string; topics: Record<string, string> };
type Script = {
  SKILL_DIR: string;
  TARGET: string;
  build(skill: Skill): string;
  made(): string;
  readSkill(): Skill;
  frontMatter(skill: string): [string, string][];
};
const script = async () => (await import("../../scripts/make-skills.mjs")) as Script;

// The skill's files as they are on disk.
let disk: Skill;
let dir: string;
beforeAll(async () => {
  const s = await script();
  disk = s.readSkill();
  dir = s.SKILL_DIR;
});

// Every file of the skill as [name, text]: SKILL.md, then each topic.
const everyFile = () => [["SKILL.md", disk.skill] as const, ...Object.entries(disk.topics).map(([id, text]) => [`references/${id}.md`, text] as const)];
// A file without its fenced code blocks, so inline code can be read on its own.
const prose = (text: string) => text.replace(/```[\s\S]*?```/g, "");
// The JSON in a file's ```json blocks.
const jsonBlocks = (text: string) => [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);

// Every property name anywhere in a JSON schema, under unions and arrays too.
function propertyNames(schema: unknown, into: Set<string>): void {
  if (!schema || typeof schema !== "object") return;
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && value && typeof value === "object") for (const name of Object.keys(value)) into.add(name);
    propertyNames(value, into);
  }
}

// The names an agent sees: every tool and every field of its input (save_style's add_links among them), every op and
// every field an op takes, the format ids, and the Style's fields.
async function knownNames(): Promise<Set<string>> {
  const server = new McpServer({ name: "easyedit-test", version: "0.0.0" });
  registerTools(server, {
    db: null as never,
    user: { id: "u1", email: "u1@gmail.com", name: "U1", image: null, allowlistRole: "editor" },
    agent: "claude",
    spaces: [],
    baseUrl: "https://studio.test",
    limits: LIMITS,
    now: () => new Date(),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientSide);
  const tools = (await client.listTools()).tools;
  await client.close();
  const names = new Set<string>();
  for (const tool of tools) {
    names.add(tool.name);
    propertyNames(tool.inputSchema, names);
  }
  for (const option of OpInput.options) names.add(option.shape.op.value as string);
  propertyNames(z.toJSONSchema(OpInput, { io: "input", unrepresentable: "any" }), names);
  for (const format of FormatId.options) names.add(format);
  for (const key of STYLE_PROFILE_KEYS) names.add(key);
  return names;
}

// A tool or op written bare, in prose or in code: a verb, an underscore, then more ("call export_video").
const TOOL_LIKE = /\b(?:get|list|add|remove|update|set|create|fill|undo|move|split|trim|replace|splice|save|delete|edit|export|post|upload|apply|make|render|insert|clear|change|copy|duplicate|read|write)_[a-z0-9_]+\b/g;
// Inline code that is one name: snake_case, like a tool, an op or a tool's input, or camelCase, like an op's field.
const ONE_NAME = /^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)+|[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)$/;

// The paths of keys an example sent that the parsed op no longer has: a field the op doesn't take, quietly dropped.
function droppedKeys(sent: unknown, kept: unknown, path = ""): string[] {
  if (!sent || typeof sent !== "object" || !kept || typeof kept !== "object") return [];
  if (Array.isArray(sent)) return Array.isArray(kept) ? sent.flatMap((item, i) => droppedKeys(item, kept[i], `${path}[${i}]`)) : [];
  return Object.entries(sent).flatMap(([key, value]) =>
    key in kept ? droppedKeys(value, (kept as Record<string, unknown>)[key], `${path}.${key}`) : [`${path}.${key}`],
  );
}

// The fields update_clip can change. Its patch is checked against the clip only when it is applied, so the op's schema
// takes any key there; its expect lists the same fields, strictly.
const UPDATE_CLIP_FIELDS: ReadonlySet<string> = (() => {
  const updateClip = OpInput.options.find((o) => o.shape.op.value === "update_clip")!;
  const expect = (updateClip.shape as unknown as { expect: z.ZodOptional<z.ZodObject> }).expect;
  return new Set(Object.keys(expect.unwrap().shape));
})();

// What is wrong with an op an example shows: the engine refuses it, it would quietly drop a field, or update_clip is
// given a field no clip has. Empty when it is fine.
function opProblems(op: unknown): string[] {
  const parsed = OpInput.safeParse(op);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const problems = droppedKeys(op, parsed.data).map((path) => `${path}: not a field of ${parsed.data.op}`);
  if (parsed.data.op === "update_clip") {
    for (const key of Object.keys(parsed.data.patch)) if (!UPDATE_CLIP_FIELDS.has(key)) problems.push(`.patch.${key}: no clip has it`);
  }
  return problems;
}

// What one skill file names that the app doesn't have, and how many names it checked: tools and ops written bare,
// names in inline code, every "op":"…", and inline ops (`{"op":…}`) with a problem.
function unknownNames(file: string, text: string, known: ReadonlySet<string>): { unknown: string[]; named: number } {
  const ops = new Set(OpInput.options.map((o) => o.shape.op.value as string));
  const unknown: string[] = [];
  let named = 0;
  // Bare words outside inline code (which is checked below), in prose and in code blocks.
  for (const [word] of text.replace(/`[^`\n]+`/g, " ").matchAll(TOOL_LIKE)) {
    named++;
    if (!known.has(word)) unknown.push(`${file}: ${word}`);
  }
  for (const [, code] of prose(text).matchAll(/`([^`\n]+)`/g)) {
    if (code.startsWith('{"op"')) {
      named++;
      let op: unknown;
      try {
        op = JSON.parse(code);
      } catch {
        op = code;
      }
      if (opProblems(op).length > 0) unknown.push(`${file}: \`${code}\``);
      continue;
    }
    if (!ONE_NAME.test(code)) continue;
    named++;
    if (!known.has(code)) unknown.push(`${file}: \`${code}\``);
  }
  for (const [, op] of text.matchAll(/"op"\s*:\s*"([^"]+)"/g)) {
    named++;
    if (!ops.has(op)) unknown.push(`${file}: op "${op}"`);
  }
  return { unknown, named };
}

describe("the generated module", () => {
  it("is exactly what the script makes from the files on disk", async () => {
    const { TARGET, made } = await script();
    expect(readFileSync(TARGET, "utf8"), "run: node scripts/make-skills.mjs").toBe(made());
  });

  it("holds SKILL.md and every topic file word for word, in SKILL.md's order", () => {
    expect(SKILL_MD).toBe(disk.skill);
    expect(SKILL_TOPICS.map((t) => t.body)).toEqual(TOPIC_IDS.map((id) => disk.topics[id]));
    expect(TOPIC_IDS).toHaveLength(14);
    expect(TOPIC_IDS[0]).toBe("hooks");
    expect(TOPIC_IDS.at(-1)).toBe("final-check");
    for (const topic of SKILL_TOPICS) {
      const lines = topic.body.split("\n");
      expect(`# ${topic.title}`).toBe(lines[0]);
      expect(topic.summary).toBe(lines[2]);
    }
    expect(skillTopic("hooks")?.title).toBe("Open strong");
    expect(skillTopic("nope")).toBeUndefined();
  });

  it("lays the files out as an installed skill", () => {
    expect(skillFiles().map((f) => f.path)).toEqual(["easyedit-video/SKILL.md", ...TOPIC_IDS.map((id) => `easyedit-video/references/${id}.md`)]);
    expect(skillFiles()[0].text).toBe(SKILL_MD);
  });

  it("the script refuses a topic SKILL.md doesn't list, a listed topic that isn't there, and a topic with no summary", async () => {
    const { build } = await script();
    const skill = "---\nname: x\ndescription: y\n---\n\n- `references/a.md` — Read this when a.\n";
    const topic = "# A\n\nRead this when a.\n";
    expect(build({ skill, topics: { a: topic } })).toContain('export type SkillTopicId = "a";');
    expect(() => build({ skill, topics: { a: topic, b: topic } })).toThrow("references/b.md is not listed in SKILL.md.");
    expect(() => build({ skill, topics: {} })).toThrow("SKILL.md lists references/a.md, which is not there.");
    expect(() => build({ skill, topics: { a: "# A\nRead this when a.\n" } })).toThrow(/second line must be blank/);
    expect(() => build({ skill, topics: { a: "A\n\nRead this when a.\n" } })).toThrow('must start with "# Title"');
    expect(() => build({ skill: skill.replace("name: x\n", ""), topics: { a: topic } })).toThrow("no name");
  });

  it("the script keeps backticks, backslashes and ${…} word for word", async () => {
    const { build } = await script();
    const tricky = "Use `update_clip`, a \\ path, ${notCode}, \\${still} and a closing `.";
    const skill = `---\nname: x\ndescription: y\n---\n\n${tricky}\n- \`references/a.md\` — Read this when a.\n`;
    const made = build({ skill, topics: { a: `# A\n\nRead this when a.\n\n${tricky}\n` } });
    const skillLiteral = /export const SKILL_MD = (`[\s\S]*?`);\n\n/.exec(made)![1];
    const bodyLiteral = /body: (`[\s\S]*?`),\n {2}\},/.exec(made)![1];
    expect(new Function(`return ${skillLiteral};`)()).toBe(skill);
    expect(new Function(`return ${bodyLiteral};`)()).toBe(`# A\n\nRead this when a.\n\n${tricky}\n`);
  });

  it("stays out of the browser: no client file imports it, and the page's words import nothing", () => {
    const clientImports = sources("src")
      .filter(([, code]) => USE_CLIENT_AT_TOP.test(code))
      .flatMap(([file, code]) => importsOf(code).filter(({ from }) => /^@\/lib\/skills(?:\/(?:index|library\.generated|zip))?$/.test(from)).map(({ from }) => `${file}: ${from}`));
    expect(clientImports, "the skill is about 250 KB of text; a page should import @/lib/skills/words only").toEqual([]);
    expect(importsOf(readFileSync("src/lib/skills/words.ts", "utf8"))).toEqual([]);
  });
});

describe("SKILL.md", () => {
  it("has front matter with only a name and a description, as claude.ai and the Agent Skills spec require", async () => {
    const { frontMatter } = await script();
    const fields = frontMatter(disk.skill);
    expect(fields.map(([key]) => key)).toEqual(["name", "description"]);
    const [[, name], [, description]] = fields;
    expect(name).toBe(basename(dir));
    expect(name).toBe(SKILL_NAME);
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(description).toBe(SKILL_DESCRIPTION);
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  it("lists every topic file once, and no file that isn't there", () => {
    const listed = [...disk.skill.matchAll(/^- `references\/([a-z0-9-]+)\.md` — (.+)$/gm)];
    expect(listed.map((m) => m[1]).sort()).toEqual(Object.keys(disk.topics).sort());
    expect(new Set(listed.map((m) => m[1])).size).toBe(listed.length);
    // Each line says when to read the topic in the topic's own words.
    for (const [, id, when] of listed) expect(when, id).toBe(disk.topics[id].split("\n")[2]);
  });

  it("stays well under the spec's 500 lines", () => {
    expect(disk.skill.split("\n").length).toBeLessThan(500);
  });
});

describe("every topic file", () => {
  it("opens with its title, a blank line and a short 'Read this when' line, and has the two sections every topic has", () => {
    for (const [id, text] of Object.entries(disk.topics)) {
      const lines = text.split("\n");
      expect(lines[0], id).toMatch(/^# \S/);
      expect(lines[1], id).toBe("");
      expect(lines[2].startsWith("Read this when "), id).toBe(true);
      expect(lines[2].length, id).toBeLessThanOrEqual(200);
      expect(lines, id).toContain("## The short version");
      expect(lines, id).toContain("## Common mistakes");
      expect(text.endsWith("\n"), id).toBe(true);
      expect(lines.length, id).toBeLessThan(350);
    }
  });

  it("shows only ops the engine accepts in its JSON examples, with no field it would drop", () => {
    let checked = 0;
    for (const [id, text] of Object.entries(disk.topics)) {
      jsonBlocks(text).forEach((block, i) => {
        const value = JSON.parse(block) as unknown;
        for (const op of Array.isArray(value) ? value : [value]) {
          expect(opProblems(op), `${id} block ${i}`).toEqual([]);
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("names only tools, tool inputs, ops and op fields that exist", async () => {
    const known = await knownNames();
    const unknown: string[] = [];
    let named = 0;
    for (const [file, text] of everyFile()) {
      const found = unknownNames(file, text, known);
      unknown.push(...found.unknown);
      named += found.named;
    }
    expect(unknown).toEqual([]);
    expect(named).toBeGreaterThan(400);
  });

  it("would catch an invented tool, op or field", async () => {
    const known = await knownNames();
    const made = [
      "Then call export_video to finish.",
      "Use `get_style` first.",
      "Set `fadeDuration` on the clip.",
      'Send {"op":"zoom_clip","clipId":"c1"}.',
      'Send `{"op":"update_clip","clipId":"c1","patch":{"glow":1}}`.',
    ].join("\n");
    expect(unknownNames("made.md", made, known).unknown).toEqual([
      "made.md: export_video",
      "made.md: `get_style`",
      "made.md: `fadeDuration`",
      'made.md: `{"op":"update_clip","clipId":"c1","patch":{"glow":1}}`',
      'made.md: op "zoom_clip"',
    ]);
    const real = 'Call get_project, then `update_clip` with `transitionIn`, or `{"op":"set_caption_style","clear":true}`.';
    expect(unknownNames("real.md", real, known).unknown).toEqual([]);
    expect(opProblems({ op: "remove_clip", clipId: "c1", glow: 1 })).toEqual([".glow: not a field of remove_clip"]);
    expect(opProblems({ op: "update_clip", clipId: "c1", patch: { volume: 0.5, glow: 1 } })).toEqual([".patch.glow: no clip has it"]);
    expect(opProblems({ op: "update_clip", clipId: "c1", patch: { transitionIn: null, volume: 0.5 } })).toEqual([]);
  });

  it("points only at topics that exist", () => {
    const ids = new Set<string>([...TOPIC_IDS, "style"]); // "style" is the space's saved Style, served by the guide
    const missing: string[] = [];
    let pointers = 0;
    for (const [file, text] of everyFile()) {
      for (const [, id] of text.matchAll(/\btopics? "([a-z0-9-]+)"/g)) {
        pointers++;
        if (!ids.has(id)) missing.push(`${file}: topic "${id}"`);
      }
      for (const [, id] of text.matchAll(/references\/([a-z0-9-]+)\.md/g)) {
        pointers++;
        if (!disk.topics[id]) missing.push(`${file}: references/${id}.md`);
      }
    }
    expect(missing).toEqual([]);
    expect(pointers).toBeGreaterThan(30);
  });
});

describe("what the topics say about a style", () => {
  const OTHER_FORMATS = FormatId.options.filter((format) => format !== "short_9x16");
  // The y a topic gives a position, for a format it names or for "the other formats" (all the same).
  const expectedY = (formats: readonly FormatId[], position: "upper" | "middle" | "lower") => {
    const values = new Set(formats.map((format) => CAPTION_POSITION_Y[format][position]));
    expect(values.size, `${formats.join(", ")} share one ${position}`).toBe(1);
    return [...values][0];
  };

  it("give every caption position the y the editor's own table has, in every format", () => {
    let checked = 0;
    const wrong: string[] = [];
    for (const [file, text] of everyFile()) {
      for (const line of text.split("\n")) {
        // A table row per format: | formats | default y | keep y between | upper | middle | lower |
        const row = /^\| ([a-z0-9_, ]+) \| ([\d.]+) \| [^|]+ \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \|$/.exec(line);
        if (row && row[1].split(", ").every((f) => (FormatId.options as string[]).includes(f))) {
          const formats = row[1].split(", ") as FormatId[];
          const [, , fallback, upper, middle, lower] = row.map(Number);
          for (const [position, y] of [["upper", upper], ["middle", middle], ["lower", lower]] as const) {
            checked++;
            if (y !== expectedY(formats, position)) wrong.push(`${file}: ${row[1]} ${position} ${y}`);
          }
          // Lower is where the editor puts captions before anyone moves them.
          if (fallback !== expectedY(formats, "lower")) wrong.push(`${file}: ${row[1]} default ${fallback}`);
          continue;
        }
        // "upper 0.25", "middle 0.45, lower 0.558", "Middle captions on short_9x16 sit at y 0.45", in prose.
        for (const m of line.matchAll(/\b(upper|middle|lower)\b(?: captions)?(?: on ([a-z0-9_]+))?(?: (?:sit at|is|at|as))?(?: y)? (\d+(?:\.\d+)?)\b/gi)) {
          const position = m[1].toLowerCase() as "upper" | "middle" | "lower";
          // Which format it is for: named with it, or the last one named before it on the line.
          const before = line.slice(0, m.index);
          const named = m[2] ?? [...before.matchAll(/short_9x16|9:16|other formats/g)].at(-1)?.[0];
          checked++;
          if (named === undefined) {
            wrong.push(`${file}: "${m[0]}" doesn't say which format it is for`);
            continue;
          }
          const formats = named === "other formats" ? OTHER_FORMATS : [named === "9:16" ? "short_9x16" : (named as FormatId)];
          if (Number(m[3]) !== expectedY(formats, position)) wrong.push(`${file}: "${m[0]}" (${named}) should be ${expectedY(formats, position)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // The captions table (6 numbers), your-style and final-check (6 each), and learn-a-style's example.
    expect(checked).toBeGreaterThanOrEqual(19);
  });

  it("read transitions at a past project's cuts with the same cutoffs Fill in from my videos uses", () => {
    const rule = disk.topics["learn-a-style"].split("\n").find((line) => line.startsWith("- Transitions:"))!;
    expect(rule).toContain('None, or under about 1 cut in 20, is "cuts". Up to about half is "few". More than half, a transition at most cuts, is "lots".');
    const byTheTopic = (share: number) => (share < 1 / 20 ? "cuts" : share <= 0.5 ? "few" : "lots");
    const none = { fade: 0, crossfade: 0, slide: 0, zoom: 0, whip: 0, dip: 0 };
    const project = (shots: number, atCuts: number): ProjectAnalysis => ({
      kind: "project",
      seconds: 30,
      format: "short_9x16",
      fps: 30,
      shots: { count: shots, averageSeconds: 1, medianSeconds: 1, firstSeconds: 1, perMinute: 60, transitions: { ...none, whip: atCuts } },
      text: { clips: 0, perMinute: 0, fonts: [], averageWords: 0, sizes: { small: 0, medium: 0, large: 0 } },
      captions: null,
      transitions: { ...none, whip: atCuts },
      textAnimations: {},
      music: null,
      speedChanges: 0,
      looks: {},
      effects: [],
    });
    // 22 shots have 21 cuts: a transition at 7 of them is a third, which is "few", not "lots".
    for (const [shots, atCuts] of [[22, 0], [41, 1], [22, 7], [22, 10], [22, 11], [22, 15], [22, 21]]) {
      expect(suggestStyle([project(shots, atCuts)]).transitions, `${atCuts} of ${shots - 1} cuts`).toBe(byTheTopic(atCuts / (shots - 1)));
    }
  });

  it("promise frame sheets from only as many videos as an agent is handed", () => {
    const promises: string[] = [];
    for (const [file, text] of everyFile()) {
      expect(text, file).not.toMatch(/(?:frame )?sheets? (?:of|for) each analyzed|grid of frames[^.]*\bfor each analyzed/);
      for (const [promise, count] of text.matchAll(/frame sheets from up to (\d+)|frames?[^.]*?, for up to (\d+)/g)) {
        promises.push(`${file}: ${promise}`);
        expect(Number(count ?? promise.match(/up to (\d+)/)![1]), `${file}: ${promise}`).toBe(AGENT_SHEETS);
      }
    }
    expect(promises.length).toBeGreaterThanOrEqual(4);
  });

  it("let a saved look sit on one adjustment layer or on each clip in the final check, never both", () => {
    const row = disk.topics["final-check"].split("\n").find((line) => line.startsWith("| look |"))!;
    expect(row).toContain("the look is in one place, never two");
    expect(row).toContain("one adjustment layer over the whole video has that look's numbers, at any amount");
    expect(row).toContain("When a layer covers the clips, leave their adjust alone");
    expect(row).not.toMatch(/If not, set them with update_clip/);
  });
});

describe("the Claude Code plugin", () => {
  it("has no version of its own, so each commit that changes a skill reaches people who installed it", () => {
    // An installed plugin is kept by its version: one left at 1.0.0 would never pick up a later skill edit. With no
    // version, Claude Code goes by the commit.
    const manifest = JSON.parse(readFileSync("plugins/easyedit/.claude-plugin/plugin.json", "utf8")) as Record<string, unknown>;
    expect(manifest.name).toBe("easyedit");
    expect(manifest).not.toHaveProperty("version");
  });

  it("tells Claude Code users to sign in after installing, and not to add EasyEdit twice", () => {
    const readme = readFileSync("plugins/easyedit/README.md", "utf8");
    expect(readme).toContain("Then run `/mcp`, pick **easyedit**, choose **Authenticate**");
    expect(readme).toContain("run `claude mcp remove easyedit` first");
    // The skill's own connect step gives Claude Code's way, sign-in included.
    const connect = disk.skill.split("\n").find((line) => line.startsWith("- **Connect.**"))!;
    expect(connect).toContain("In Claude Code, it's `claude mcp add --transport http easyedit https://easyedit.arush.dev/api/mcp`");
    expect(connect).toContain("then they run `/mcp`, pick easyedit and choose Authenticate");
  });
});
