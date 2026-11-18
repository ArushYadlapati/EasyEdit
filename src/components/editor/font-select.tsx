"use client";

import type { ComponentProps } from "react";
import { Select } from "@/components/ui/select";
import { FONT_LIST, isListedFont } from "@/lib/brand/fonts";
import { useBrand } from "./brand/brand-context";

const ROLE_LABELS = [["title", "Title"], ["subtitle", "Subtitle"], ["body", "Body"]] as const;
// A kit entry's value names its role, not its font, so the menu never shows a clip's font as a role: a clip doesn't
// record which kind of text it came from, and the kit's roles may share a font.
const KIT_VALUE = "brand-kit:";

// The font menu of the inspector and the Captions tab: the space's brand kit fonts first, by the kind of text each is
// for, then every font there is. The shown entry is the font itself, from All fonts. A font not in the list (an agent
// may write any name) shows as its own entry, so the menu never claims another font. onPick gets a font's name.
export function FontSelect({ family, onPick, ...rest }: Omit<ComponentProps<"select">, "value" | "onChange" | "children"> & { family: string; onPick(family: string): void }) {
  const { fonts } = useBrand().kit;
  const fontOf = (value: string) => {
    const role = ROLE_LABELS.find(([r]) => value === `${KIT_VALUE}${r}`)?.[0];
    return role ? fonts[role] : value;
  };
  return (
    <Select {...rest} value={family} onChange={(event) => onPick(fontOf(event.target.value))}>
      {!isListedFont(family) && <option value={family}>{family}</option>}
      <optgroup label="Brand kit">
        {ROLE_LABELS.map(([role, label]) => (
          <option key={role} value={`${KIT_VALUE}${role}`}>{`${label} · ${fonts[role]}`}</option>
        ))}
      </optgroup>
      <optgroup label="All fonts">
        {FONT_LIST.map((f) => (
          <option key={f.family} value={f.family}>
            {f.family}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}
