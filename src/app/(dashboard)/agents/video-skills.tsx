"use client";

import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { linkButtonClass } from "@/components/ui/button-class";
import { AGENT_SKILLS_FOLDER, PLUGIN_COMMANDS, SKILL_WORDS, SKILL_ZIP_NAME, SKILL_ZIP_PATH } from "@/lib/skills/words";
import { CopyButton } from "./copy";

const TEXT = "text-[13px] leading-5 text-ed-text [overflow-wrap:anywhere]";
// A command shown whole: it wraps onto more lines rather than being cut off in a narrow window, and a click selects all
// of it. 28 px tall on one line, as the Copy button beside it.
const COMMAND = "min-w-0 flex-1 rounded-md border border-ed-line bg-ed-raised px-3 py-[3px] font-mono text-xs leading-5 text-ed-text select-all [overflow-wrap:anywhere]";

function Way({ name, children }: { name: string; children: ReactNode }): ReactNode {
  return (
    <li className="flex min-w-0 flex-col gap-2 border-t border-ed-line pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-[13px] font-semibold text-ed-text">{name}</h3>
      {children}
    </li>
  );
}

// The body of the AI agents page's "Video skills" section: connected agents already have the skills; Claude Code adds
// them, with the connection, from two commands, each shown whole with Copy beside it; agents that read skills from a
// folder unzip the download; and Claude on the web takes the same file as an upload.
export function VideoSkills(): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className={TEXT}>{SKILL_WORDS.connected}</p>
      <ul aria-label={SKILL_WORDS.ways} className="flex min-w-0 flex-col gap-3 rounded-md border border-ed-line bg-ed-panel p-3">
        <Way name={SKILL_WORDS.claudeCode.name}>
          <p className={TEXT}>{SKILL_WORDS.claudeCode.text}</p>
          {PLUGIN_COMMANDS.map(({ command, label, copyLabel }) => (
            <div key={command} role="group" aria-label={label} className="flex min-w-0 items-start gap-2">
              <code className={COMMAND}>{command}</code>
              <CopyButton text={command} label={copyLabel} />
            </div>
          ))}
        </Way>
        <Way name={SKILL_WORDS.otherAgents.name}>
          <p className={TEXT}>
            {SKILL_WORDS.otherAgents.before}
            <code className="font-mono text-xs">{AGENT_SKILLS_FOLDER}</code>
            {SKILL_WORDS.otherAgents.after}
          </p>
          <a href={SKILL_ZIP_PATH} download={SKILL_ZIP_NAME} className={linkButtonClass("default", "self-start")}>
            <Download aria-hidden />
            {SKILL_WORDS.download}
          </a>
        </Way>
        <Way name={SKILL_WORDS.claudeWeb.name}>
          <p className={TEXT}>{SKILL_WORDS.claudeWeb.text}</p>
        </Way>
      </ul>
    </div>
  );
}
