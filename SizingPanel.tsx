/**
 * SizingPanel.tsx — a worked example of AR-6: one configuration section as a small,
 * self-contained panel bound to its composed sub-config (SizingConfig), instead of a
 * slice of the 11,433-line BatchConfigDialog.
 *
 * It demonstrates the whole strangler loop on a real section:
 *   - `ModeValueControl` is a reusable control for ANY NumericModeValue (range/fixed/
 *     incremental + modulation), so every one of the ~56 blocks reuses it.
 *   - `SizingPanel` composes those controls; it knows nothing about flat field names.
 *   - `SizingPanelSection` is the drop-in bridge: it lives inside the existing dialog,
 *     collapses the flat config in and expands edits back out, so the old code is
 *     untouched until this panel fully owns the section.
 *
 * UI primitives are imported from the repo's existing shadcn/ui set (`@/components/ui/*`).
 * REMINDER (from the shared/schema audit): every <Select> inside a Radix Dialog needs the
 * dialog z-index workaround on its <SelectContent> — encapsulate that once in a shared
 * <DialogSelect> wrapper (AR-6) rather than repeating it here.
 */

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { NumericModeValue, IncrementalIndexDriver } from "./mode-value";
import type { SizingConfig } from "./batch-config-sections";
import type { BatchConfigSettings } from "@shared/schema";
import { collapseSizing, expandSizing } from "./strangler-adapter";

/* ---------------------- reusable numeric mode control ---------------------- */

interface ModeValueControlProps {
  label: string;
  value: NumericModeValue;
  onChange: (next: NumericModeValue) => void;
  min?: number;
  max?: number;
  step?: number;
}

function ModeValueControl({ label, value, onChange, min, max, step = 1 }: ModeValueControlProps) {
  const set = (patch: Partial<NumericModeValue>) => onChange({ ...value, ...patch });
  const numAttrs = { min, max, step, type: "number" as const };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <Select value={value.mode} onValueChange={(m) => set({ mode: m as NumericModeValue["mode"] })}>
          <SelectTrigger className="h-8 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="range">Range</SelectItem>
            <SelectItem value="fixed">Fixed</SelectItem>
            <SelectItem value="incremental">Incremental</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.mode === "range" && (
        <div className="flex gap-2">
          <Input
            {...numAttrs}
            aria-label={`${label} min`}
            value={value.range[0]}
            onChange={(e) => set({ range: [Number(e.target.value), value.range[1]] })}
          />
          <Input
            {...numAttrs}
            aria-label={`${label} max`}
            value={value.range[1]}
            onChange={(e) => set({ range: [value.range[0], Number(e.target.value)] })}
          />
        </div>
      )}

      {value.mode === "fixed" && (
        <Input
          {...numAttrs}
          aria-label={label}
          value={value.fixed}
          onChange={(e) => set({ fixed: Number(e.target.value) })}
        />
      )}

      {value.mode === "incremental" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              {...numAttrs}
              aria-label={`${label} start`}
              value={value.start}
              onChange={(e) => set({ start: Number(e.target.value) })}
            />
            <Input
              {...numAttrs}
              aria-label={`${label} increment`}
              value={value.increment}
              onChange={(e) => set({ increment: Number(e.target.value) })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Advance per</Label>
            <Select
              value={value.indexDriver}
              onValueChange={(d) => set({ indexDriver: d as IncrementalIndexDriver })}
            >
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shapeIndex">Shape</SelectItem>
                <SelectItem value="setRepIndex">Set repetition</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={value.modulation.enabled}
              onCheckedChange={(enabled) =>
                set({ modulation: { ...value.modulation, enabled } })
              }
            />
            <Label className="text-xs text-muted-foreground">Modulate (wrap at)</Label>
            <Input
              {...numAttrs}
              className="w-24"
              disabled={!value.modulation.enabled}
              aria-label={`${label} modulation value`}
              value={value.modulation.value}
              onChange={(e) =>
                set({ modulation: { ...value.modulation, value: Number(e.target.value) } })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- the panel ------------------------------- */

export interface SizingPanelProps {
  value: SizingConfig;
  onChange: (next: SizingConfig) => void;
}

export function SizingPanel({ value, onChange }: SizingPanelProps) {
  const set = (patch: Partial<SizingConfig>) => onChange({ ...value, ...patch });

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Switch checked={value.enabled} onCheckedChange={(enabled) => set({ enabled })} />
        <Label className="text-sm font-semibold">Dimensions</Label>
      </div>

      <fieldset disabled={!value.enabled} className="space-y-4 disabled:opacity-50">
        <ModeValueControl
          label="Width"
          value={value.width}
          onChange={(width) => set({ width })}
          min={value.minimumSize}
          max={value.maximumSize}
        />
        <ModeValueControl
          label="Height"
          value={value.height}
          onChange={(height) => set({ height })}
          min={value.minimumSize}
          max={value.maximumSize}
        />

        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Constraint</Label>
          <Select
            value={value.constraint}
            onValueChange={(c) => set({ constraint: c as SizingConfig["constraint"] })}
          >
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (W/H independent)</SelectItem>
              <SelectItem value="min">Min → square</SelectItem>
              <SelectItem value="max">Max → square</SelectItem>
              <SelectItem value="avg">Average → square</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Minimum size</Label>
            <Input
              type="number"
              value={value.minimumSize}
              onChange={(e) => set({ minimumSize: Number(e.target.value) })}
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Maximum size</Label>
            <Input
              type="number"
              value={value.maximumSize}
              onChange={(e) => set({ maximumSize: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={value.incrementalResetPerBatch}
            onCheckedChange={(incrementalResetPerBatch) => set({ incrementalResetPerBatch })}
          />
          <Label className="text-xs text-muted-foreground">
            Reset incremental count each batch
          </Label>
        </div>
      </fieldset>
    </section>
  );
}

/* ------------------------- strangler bridge (drop-in) ------------------------- */

export interface SizingPanelSectionProps {
  config: BatchConfigSettings;
  setConfig: (next: BatchConfigSettings) => void;
}

/**
 * Mount THIS inside the existing BatchConfigDialog where the old "Dimensions" markup
 * is today. It owns only the sizing fields; everything else in `config` is preserved
 * by the spread in `expandSizing`. Once this is shipped and trusted, delete the old
 * dimensions code from BatchConfigDialog.tsx — that is the section "strangled".
 */
export function SizingPanelSection({ config, setConfig }: SizingPanelSectionProps) {
  const sizing = useMemo(() => collapseSizing(config), [config]);
  return (
    <SizingPanel
      value={sizing}
      onChange={(next) => setConfig({ ...config, ...expandSizing(next) })}
    />
  );
}
