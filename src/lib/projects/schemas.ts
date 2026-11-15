import { z } from "zod";
import { LIMITS } from "@/lib/limits";
import { isStorableText, withSuffix } from "@/lib/text";
import {
  CUSTOM_SIZE_ONLY,
  FORMAT_PRESETS,
  FRAME_SIZE_MESSAGE,
  FormatId,
  formatFor,
  isFrameSize,
  isPresetId,
} from "@/lib/timeline";

export const projectName: z.ZodType<string> = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.projectNameChars)
  .refine(isStorableText);

export const folderName: z.ZodType<string> = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.folderNameChars)
  .refine(isStorableText);

export type ProjectFrame = { format: FormatId; width: number; height: number };

// The format and size a new project is made with. A size is given only with "custom", and a custom size equal to
// a named one is that named size.
export function projectFrame(input: { format: string; width?: number; height?: number }): ProjectFrame | { error: string } {
  const format = FormatId.safeParse(input.format);
  if (!format.success) return { error: "Pick a format." };
  const { width, height } = input;
  if (isPresetId(format.data)) {
    if (width !== undefined || height !== undefined) return { error: CUSTOM_SIZE_ONLY };
    const preset = FORMAT_PRESETS[format.data];
    return { format: format.data, width: preset.width, height: preset.height };
  }
  if (width === undefined || height === undefined || !isFrameSize(width, height)) return { error: FRAME_SIZE_MESSAGE };
  return { format: formatFor(width, height), width, height };
}

const COPY_SUFFIX = " copy";

// The name of a duplicated project. A long name is shortened by whole characters, so an emoji is never split.
export function copyName(name: string): string {
  return withSuffix(name, COPY_SUFFIX, LIMITS.projectNameChars);
}

export const FOLDER_GONE = "That folder no longer exists.";
