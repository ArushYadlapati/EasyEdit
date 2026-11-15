"use client";

import { useState } from "react";
import { BrandKitEditor } from "@/components/brand/brand-kit-editor";
import { addLogo, addText, recolorSelection } from "@/lib/editor/actions";
import { TEXT_PRESETS } from "@/lib/editor/text-presets";
import { useEditor, useEditorStore, useSettingsStore } from "../context";
import type { PanelProps } from "../media/media-tab";
import { useBrand } from "./brand-context";
import { LogoPicker } from "./logo-picker";

// The left panel's Brand kit tab: the space's kit, where a font adds that kind of text at the playhead, a color
// recolors the selected text and a logo is added at the playhead, on top of the video at a medium size. Editors change the kit here too.
export function BrandTab({ panel }: { panel: PanelProps }) {
  const store = useEditorStore();
  const settings = useSettingsStore();
  const canEditProject = useEditor((s) => s.canEdit);
  const { kit, canEdit, save } = useBrand();
  const [picking, setPicking] = useState(false);
  const inKit = new Set(kit.logos.map((l) => l.id));

  return (
    <div {...panel} className="min-h-0 flex-1 overflow-y-auto">
      <div className="p-3">
        <BrandKitEditor
          kit={kit}
          canEdit={canEdit}
          save={save}
          layout="panel"
          onUseFont={canEditProject ? (role) => addText(store, TEXT_PRESETS.find((p) => p.role === role)!, settings.getState().textSeconds, kit.fonts) : undefined}
          onUseColor={canEditProject ? (hex) => recolorSelection(store, hex) : undefined}
          onUseLogo={canEditProject ? (asset) => addLogo(store, asset, { stillSeconds: settings.getState().stillSeconds }) : undefined}
          onAddLogo={() => setPicking(true)}
        />
      </div>
      <LogoPicker
        open={picking}
        onClose={() => setPicking(false)}
        inKit={inKit}
        onPick={(asset) => {
          setPicking(false);
          void save({ logoAssetIds: [...kit.logos.map((l) => l.id), asset.id] });
        }}
      />
    </div>
  );
}
