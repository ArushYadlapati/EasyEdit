import type { FormatId, SlotSummary, TimelineDoc } from "@/lib/timeline";

export type TemplateSummary = {
  id: string;
  name: string;
  description: string;
  format: FormatId;
  width: number;
  height: number;
  builtIn: boolean;
  slots: SlotSummary[];
  updatedAt: string | null;
};

export type Template = TemplateSummary & { instructions: string; doc: TimelineDoc };
