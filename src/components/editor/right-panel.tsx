"use client";

import { useId, useState } from "react";
import { Tabs, tabIds } from "@/components/ui/tabs";
import { ActivityPanel } from "./activity-panel";
import { EffectsPanel } from "./effects-panel";
import { Inspector } from "./inspector";
import { ReviewPanel } from "./review/review-panel";

// Exported for the top bar's search, which opens them by name.
export const RIGHT_TABS = [
  { id: "inspect", label: "Inspect" },
  { id: "activity", label: "Activity" },
  { id: "effects", label: "Effects" },
  { id: "review", label: "Review" },
];
const TABS = RIGHT_TABS;

// tab and onTab, when given, hold the open tab outside, so the top bar's search can open one; without them the panel
// keeps its own.
export function RightPanel({ tab: heldTab, onTab }: { tab?: string; onTab?(tab: string): void } = {}) {
  const [ownTab, setOwnTab] = useState("inspect");
  const tab = heldTab ?? ownTab;
  const setTab = onTab ?? setOwnTab;
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const idPrefix = useId();
  const ids = tabIds(idPrefix, current.id);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Four tabs: dense, with a narrower gutter, so each word shows whole at the panel's narrowest (240 px). */}
      <div className="flex h-11 shrink-0 items-center border-b border-ed-line px-1.5">
        <Tabs label="Details" value={current.id} tabs={TABS} onChange={setTab} idPrefix={idPrefix} dense />
      </div>
      <div id={ids.panel} role="tabpanel" aria-labelledby={ids.tab} className="min-h-0 flex-1 overflow-y-auto">
        {current.id === "inspect" && <Inspector />}
        {current.id === "activity" && <ActivityPanel />}
        {current.id === "effects" && <EffectsPanel />}
        {current.id === "review" && <ReviewPanel />}
      </div>
    </div>
  );
}
