"use client";

import { Plus, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { usePoster } from "@/components/editor/media/use-poster";
import { Button } from "@/components/ui/button";
import { DISABLED, FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { FONT_LIST } from "@/lib/brand/fonts";
import { BRAND_LIMITS, HEX_COLOR, type BrandKit, type BrandKitPatch, type BrandRole } from "@/lib/brand/types";
import { cssFontFamily } from "@/lib/editor/fonts";
import type { AssetView } from "@/lib/media/types";

const TEXT = "text-[13px] leading-5";
const HEADING = "text-xs font-semibold text-ed-muted";

// Each kind of text: what it is called, the patch field for its font, and the weight its sample is drawn at.
const ROLES: { role: BrandRole; label: string; field: "titleFont" | "subtitleFont" | "bodyFont"; weight: number }[] = [
  { role: "title", label: "Title", field: "titleFont", weight: 700 },
  { role: "subtitle", label: "Subtitle", field: "subtitleFont", weight: 500 },
  { role: "body", label: "Body text", field: "bodyFont", weight: 400 },
];

export type BrandKitEditorProps = {
  kit: BrandKit;
  canEdit: boolean;
  save(patch: BrandKitPatch): Promise<void>;
  onUseFont?(role: BrandRole): void; // clicking a font's sample; without it the sample is not a button
  onUseColor?(hex: string): void;
  onUseLogo?(asset: AssetView): void;
  onAddLogo?(): void; // opens the caller's picker; without it there is no Add logo
  layout: "panel" | "page";
};

function Part({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className={HEADING}>
        {title}
      </h3>
      {children}
    </section>
  );
}

// The X on a swatch's or logo's corner. A 20 px badge mostly outside the tile, and only clickable while it shows (the
// tile hovered, or the badge focused by keyboard): a hidden one over the tile would take the click meant for the tile.
function RemoveBadge({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "absolute -top-2.5 -right-2.5 flex size-5 items-center justify-center rounded-full border border-ed-line bg-ed-panel text-ed-muted",
        "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
        "hover:text-ed-text [&>svg]:size-3",
        FOCUS_RING,
        FADE,
      )}
      onClick={onClick}
    >
      <X aria-hidden />
    </button>
  );
}

const SAMPLE = cx("flex min-w-0 flex-1 flex-col items-start rounded-md px-2 py-1.5 text-left", FADE);

function Fonts({ kit, canEdit, save, onUseFont }: BrandKitEditorProps) {
  return (
    <Part title="Fonts">
      {ROLES.map(({ role, label, field, weight }) => {
        const family = kit.fonts[role];
        const sample = (
          <>
            <span className="truncate text-base text-ed-text" style={{ fontWeight: weight }}>
              {label}
            </span>
            <span className={cx(TEXT, "truncate text-ed-muted")}>{family}</span>
          </>
        );
        return (
          <div key={role} className="flex min-w-0 flex-col gap-1 rounded-md border border-ed-line p-1">
            {onUseFont ? (
              <button
                type="button"
                data-edit-control
                aria-label={`Add ${label.toLowerCase()}`}
                className={cx(SAMPLE, "enabled:hover:bg-ed-hover", FOCUS_RING, DISABLED)}
                style={{ fontFamily: cssFontFamily(family) }}
                onClick={() => onUseFont(role)}
              >
                {sample}
              </button>
            ) : (
              <div className={SAMPLE} style={{ fontFamily: cssFontFamily(family) }}>
                {sample}
              </div>
            )}
            {canEdit && (
              <Select aria-label={`${label} font`} value={family} onChange={(e) => void save({ [field]: e.target.value })}>
                {FONT_LIST.map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.family}
                  </option>
                ))}
              </Select>
            )}
          </div>
        );
      })}
    </Part>
  );
}

function Colors({ kit, canEdit, save, onUseColor }: BrandKitEditorProps) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const full = kit.colors.length >= BRAND_LIMITS.colors;

  function add() {
    const hex = draft.trim();
    if (!HEX_COLOR.test(hex)) {
      setProblem("Use a hex color like #ff5a1f.");
      return;
    }
    setProblem(null);
    setDraft("");
    void save({ colors: [...kit.colors, hex.toLowerCase()] });
  }

  return (
    <Part title="Colors">
      {kit.colors.length === 0 && <p className={cx(TEXT, "text-ed-muted")}>No colors yet.</p>}
      <ul className="flex flex-wrap gap-2">
        {kit.colors.map((hex) => (
          <li key={hex} className="group relative">
            {onUseColor ? (
              <button
                type="button"
                data-edit-control
                aria-label={hex}
                title={hex}
                className={cx("size-8 rounded-md border border-ed-line", FOCUS_RING, FADE)}
                style={{ background: hex }}
                onClick={() => onUseColor(hex)}
              />
            ) : (
              <span title={hex} className="block size-8 rounded-md border border-ed-line" style={{ background: hex }} />
            )}
            {canEdit && <RemoveBadge label={`Remove ${hex}`} onClick={() => void save({ colors: kit.colors.filter((c) => c !== hex) })} />}
          </li>
        ))}
      </ul>
      {canEdit && !full && (
        <div className="flex min-w-0 items-center gap-2">
          <input
            type="color"
            aria-label="Pick a color"
            className={cx("h-7 w-8 shrink-0 cursor-pointer rounded-md border border-ed-line bg-transparent", FOCUS_RING)}
            value={HEX_COLOR.test(draft) ? draft.toLowerCase() : "#ffffff"}
            onChange={(e) => setDraft(e.target.value)}
          />
          <TextInput
            aria-label="New color"
            placeholder="#ff5a1f"
            className="min-w-0 flex-1 font-mono"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button onClick={add}>Add color</Button>
        </div>
      )}
      {problem && (
        <p role="alert" className={cx(TEXT, "text-ed-danger")}>
          {problem}
        </p>
      )}
    </Part>
  );
}

function LogoPicture({ asset }: { asset: AssetView }) {
  const poster = usePoster(asset, true);
  return poster ? (
    // eslint-disable-next-line @next/next/no-img-element -- a blob address of the space's own image, not a page asset
    <img src={poster} alt="" className="size-full object-contain" />
  ) : (
    <span className={cx(TEXT, "truncate px-1 text-ed-muted")}>{asset.name}</span>
  );
}

function Logos({ kit, canEdit, save, onUseLogo, onAddLogo, layout }: BrandKitEditorProps) {
  const tile = layout === "page" ? "size-24" : "size-20";
  return (
    <Part title="Logos">
      {kit.logos.length === 0 && <p className={cx(TEXT, "text-ed-muted")}>No logos yet.</p>}
      <ul className="flex flex-wrap gap-2">
        {kit.logos.map((asset) => (
          <li key={asset.id} className="group relative">
            {onUseLogo ? (
              <button
                type="button"
                data-edit-control
                aria-label={`Add ${asset.name}`}
                title={asset.name}
                className={cx(tile, "flex items-center justify-center overflow-hidden rounded-md border border-ed-line bg-ed-bg enabled:hover:bg-ed-hover", FOCUS_RING, FADE, DISABLED)}
                onClick={() => onUseLogo(asset)}
              >
                <LogoPicture asset={asset} />
              </button>
            ) : (
              <div title={asset.name} className={cx(tile, "flex items-center justify-center overflow-hidden rounded-md border border-ed-line bg-ed-bg")}>
                <LogoPicture asset={asset} />
              </div>
            )}
            {canEdit && (
              <RemoveBadge
                label={`Remove ${asset.name} from the kit`}
                onClick={() => void save({ logoAssetIds: kit.logos.filter((l) => l.id !== asset.id).map((l) => l.id) })}
              />
            )}
          </li>
        ))}
      </ul>
      {canEdit && onAddLogo && kit.logos.length < BRAND_LIMITS.logos && (
        <Button className="self-start" onClick={onAddLogo}>
          <Plus aria-hidden size={16} /> Add logo
        </Button>
      )}
    </Part>
  );
}

// A space's brand kit: its fonts for each kind of text, its colors and its logos. The editor's Brand kit tab and the
// dashboard's Brand kit page both draw it; the caller says what clicking a font, color or logo does (the editor adds
// it to the project) and how a logo is picked. Viewers see the kit with nothing to change.
export function BrandKitEditor(props: BrandKitEditorProps): ReactNode {
  return (
    <div className={cx("flex min-w-0 flex-col", props.layout === "page" ? "gap-6" : "gap-5")}>
      <Fonts {...props} />
      <Colors {...props} />
      <Logos {...props} />
    </div>
  );
}
