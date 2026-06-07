/**
 * batch-config-roundtrip.test.ts — the gate that makes incremental strangling safe.
 *
 * Asserts the invariant: for every migrated section, expand(collapse(f)) reproduces
 * the original flat fields exactly, for ALL modes. Because the canonical ModeValue is
 * lossless, this must hold no matter which mode each block is in. Run in CI (AR-5)
 * BEFORE deleting any old dialog code for a section (AR-2).
 *
 * Run: `npx vitest run batch-config-roundtrip`
 * Needs `defaultBatchConfigSettings` (shared/schema.ts) as the realistic baseline.
 */

import { describe, it, expect } from "vitest";
import { defaultBatchConfigSettings, type BatchConfigSettings } from "@shared/schema";
import {
  collapseSizing,
  expandSizing,
  collapseShapeParams,
  expandShapeParams,
  collapseStroke,
  expandStroke,
} from "./strangler-adapter";

/** The exact flat keys each migrated section owns. Round-trip must preserve these. */
const SIZING_KEYS = [
  "shapePropertiesDimensionsEnabled", "sizeConstraintMode", "sizeIncrementalResetPerBatch",
  "minimumSize", "maximumSize",
  "widthMode", "widthRange", "widthValue", "widthStartValue", "widthIncrement",
  "widthModulationEnabled", "widthModulationValue",
  "heightMode", "heightRange", "heightValue", "heightStartValue", "heightIncrement",
  "heightModulationEnabled", "heightModulationValue",
  "sizeIncrementalIndexDriver",
] as const;

const SHAPE_PARAM_PREFIXES = ["rectangleCornerRadius", "starInnerRadius", "ringInnerRadius"];
const SHAPE_PARAM_SUFFIXES = [
  "Mode", "Range", "Define", "StartValue", "Increment",
  "ModulationEnabled", "ModulationValue", "IncrementalIndexDriver",
];
const SHAPE_PARAM_KEYS = SHAPE_PARAM_PREFIXES.flatMap((p) => SHAPE_PARAM_SUFFIXES.map((s) => p + s));

const STROKE_KEYS = [
  "strokeEnabled", "strokeColorEnabled", "strokeOpacityEnabled", "strokeWidthEnabled",
  "strokeColorMode", "strokeColorRange", "strokeColorRangeFlip", "strokeColorPalette",
  "strokeColorDefine", "strokeColorSaturationRange", "strokeColorLightnessRange",
  "strokeOpacityMode", "strokeOpacityRange", "strokeOpacityDefine", "strokeOpacityStartValue",
  "strokeOpacityIncrement", "strokeOpacityModulationEnabled", "strokeOpacityModulationValue",
  "strokeWidthMode", "strokeWidthRange", "strokeWidthDefine", "strokeWidthStartValue",
  "strokeWidthIncrement", "strokeWidthModulationEnabled", "strokeWidthModulationValue",
];

function pick(o: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
}

/** Force each block into a specific mode so we test all branches, not just defaults. */
function withModes(base: BatchConfigSettings, mode: string): BatchConfigSettings {
  const f = { ...base } as Record<string, unknown>;
  for (const k of Object.keys(f)) {
    if (k.endsWith("Mode") && typeof f[k] === "string") {
      const allowed = ["range", "value", "define", "incremental"];
      if (allowed.includes(mode) && allowed.includes(f[k] as string)) f[k] = mode;
    }
  }
  return f as BatchConfigSettings;
}

describe("batch-config strangler round-trip", () => {
  const baselines: Record<string, BatchConfigSettings> = {
    defaults: defaultBatchConfigSettings,
    rangeAll: withModes(defaultBatchConfigSettings, "range"),
    incrementalAll: withModes(defaultBatchConfigSettings, "incremental"),
  };

  for (const [name, base] of Object.entries(baselines)) {
    const flat = base as unknown as Record<string, unknown>;

    it(`sizing is lossless (${name})`, () => {
      const out = { ...flat, ...expandSizing(collapseSizing(base)) };
      expect(pick(out, SIZING_KEYS)).toEqual(pick(flat, SIZING_KEYS));
    });

    it(`shapeParams is lossless (${name})`, () => {
      const out = { ...flat, ...expandShapeParams(collapseShapeParams(base)) };
      expect(pick(out, SHAPE_PARAM_KEYS)).toEqual(pick(flat, SHAPE_PARAM_KEYS));
    });

    it(`stroke is lossless (${name})`, () => {
      const out = { ...flat, ...expandStroke(collapseStroke(base)) };
      expect(pick(out, STROKE_KEYS)).toEqual(pick(flat, STROKE_KEYS));
    });
  }

  it("expand touches ONLY its own keys (no leakage into other sections)", () => {
    const sizingOut = expandSizing(collapseSizing(defaultBatchConfigSettings)) as Record<string, unknown>;
    const leaked = Object.keys(sizingOut).filter((k) => !SIZING_KEYS.includes(k as (typeof SIZING_KEYS)[number]));
    expect(leaked).toEqual([]);
  });
});
