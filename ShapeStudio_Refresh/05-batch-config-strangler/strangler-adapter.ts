/**
 * strangler-adapter.ts — the bridge that lets new composed panels live ALONGSIDE
 * the existing 11,433-line BatchConfigDialog without a rewrite.
 *
 * THE STRANGLER LOOP (per section):
 *   1. `collapse*` reads the relevant flat fields into a composed sub-config.
 *   2. A new panel edits that composed sub-config.
 *   3. `expand*` writes it back as a PARTIAL flat object.
 *   4. Spread that partial over the live BatchConfigSettings:
 *        setConfig({ ...config, ...expandSizing(next) })
 *      Every not-yet-migrated field is preserved verbatim, so the old dialog and the
 *      existing generator keep working. Sections are strangled one at a time; when a
 *      section's panel fully owns its fields, the old dialog code for it is deleted.
 *
 * ROUND-TRIP INVARIANT (assert this in CI — AR-2):
 *   For every migrated section, expand(collapse(f)) deep-equals f on that section's
 *   keys. Because the canonical value is lossless (carries all per-mode payloads),
 *   this holds regardless of the active mode. See generation-parity.test.ts for the
 *   harness style; add a `batch-config-roundtrip.test.ts` that runs each descriptor.
 *
 * Field descriptors below are transcribed directly from shared/schema.ts. Note the
 * two naming quirks the descriptors absorb so the panels never see them:
 *   - sizing's fixed kind is spelled 'value' (`widthValue`); everything else is
 *     'define' (`…Define`).
 *   - width & height SHARE one driver (`sizeIncrementalIndexDriver`); rectangle/star/
 *     ring each own theirs; stroke opacity/width have none.
 */

import type { BatchConfigSettings } from "@shared/schema";
import {
  collapseNumeric,
  expandNumeric,
  collapseColor,
  expandColor,
  type NumericFlatKeys,
  type ColorFlatKeys,
} from "./mode-value";
import type {
  ComposedBatchConfig,
  SizingConfig,
  ShapeParamsConfig,
  StrokeConfig,
} from "./batch-config-sections";

type Flat = Record<string, unknown>;
const asFlat = (c: BatchConfigSettings): Flat => c as unknown as Flat;

/* ----------------------------- descriptors ----------------------------- */

const WIDTH: NumericFlatKeys = {
  mode: "widthMode",
  fixedKind: "value",
  range: "widthRange",
  fixed: "widthValue",
  start: "widthStartValue",
  increment: "widthIncrement",
  sharedIndexDriver: "sizeIncrementalIndexDriver",
  modulationEnabled: "widthModulationEnabled",
  modulationValue: "widthModulationValue",
};

const HEIGHT: NumericFlatKeys = {
  mode: "heightMode",
  fixedKind: "value",
  range: "heightRange",
  fixed: "heightValue",
  start: "heightStartValue",
  increment: "heightIncrement",
  sharedIndexDriver: "sizeIncrementalIndexDriver",
  modulationEnabled: "heightModulationEnabled",
  modulationValue: "heightModulationValue",
};

function radiusKeys(prefix: string): NumericFlatKeys {
  // rectangleCornerRadius* / starInnerRadius* / ringInnerRadius* all share this shape.
  return {
    mode: `${prefix}Mode`,
    fixedKind: "define",
    range: `${prefix}Range`,
    fixed: `${prefix}Define`,
    start: `${prefix}StartValue`,
    increment: `${prefix}Increment`,
    indexDriver: `${prefix}IncrementalIndexDriver`,
    modulationEnabled: `${prefix}ModulationEnabled`,
    modulationValue: `${prefix}ModulationValue`,
  };
}
const RECT_CORNER = radiusKeys("rectangleCornerRadius");
const STAR_INNER = radiusKeys("starInnerRadius");
const RING_INNER = radiusKeys("ringInnerRadius");

function strokeNumericKeys(prefix: string): NumericFlatKeys {
  // strokeOpacity* / strokeWidth* — 'define' fixed kind, no index driver.
  return {
    mode: `${prefix}Mode`,
    fixedKind: "define",
    range: `${prefix}Range`,
    fixed: `${prefix}Define`,
    start: `${prefix}StartValue`,
    increment: `${prefix}Increment`,
    modulationEnabled: `${prefix}ModulationEnabled`,
    modulationValue: `${prefix}ModulationValue`,
  };
}
const STROKE_OPACITY = strokeNumericKeys("strokeOpacity");
const STROKE_WIDTH = strokeNumericKeys("strokeWidth");

const STROKE_COLOR: ColorFlatKeys = {
  mode: "strokeColorMode",
  range: "strokeColorRange",
  flip: "strokeColorRangeFlip",
  saturation: "strokeColorSaturationRange",
  lightness: "strokeColorLightnessRange",
  palette: "strokeColorPalette",
  define: "strokeColorDefine",
};

/* ------------------------------- sizing -------------------------------- */

export function collapseSizing(c: BatchConfigSettings): SizingConfig {
  const f = asFlat(c);
  return {
    enabled: Boolean(f.shapePropertiesDimensionsEnabled),
    width: collapseNumeric(f, WIDTH),
    height: collapseNumeric(f, HEIGHT),
    constraint: (f.sizeConstraintMode as SizingConfig["constraint"]) ?? "none",
    incrementalResetPerBatch: Boolean(f.sizeIncrementalResetPerBatch),
    minimumSize: Number(f.minimumSize ?? 0),
    maximumSize: Number(f.maximumSize ?? 0),
  };
}

export function expandSizing(s: SizingConfig): Partial<BatchConfigSettings> {
  const out: Flat = {
    shapePropertiesDimensionsEnabled: s.enabled,
    sizeConstraintMode: s.constraint,
    sizeIncrementalResetPerBatch: s.incrementalResetPerBatch,
    minimumSize: s.minimumSize,
    maximumSize: s.maximumSize,
  };
  expandNumeric(s.width, WIDTH, out);
  expandNumeric(s.height, HEIGHT, out);
  return out as Partial<BatchConfigSettings>;
}

/* ----------------------------- shapeParams ----------------------------- */

export function collapseShapeParams(c: BatchConfigSettings): ShapeParamsConfig {
  const f = asFlat(c);
  return {
    rectangleCornerRadius: collapseNumeric(f, RECT_CORNER),
    starInnerRadius: collapseNumeric(f, STAR_INNER),
    ringInnerRadius: collapseNumeric(f, RING_INNER),
  };
}

export function expandShapeParams(s: ShapeParamsConfig): Partial<BatchConfigSettings> {
  const out: Flat = {};
  expandNumeric(s.rectangleCornerRadius, RECT_CORNER, out);
  expandNumeric(s.starInnerRadius, STAR_INNER, out);
  expandNumeric(s.ringInnerRadius, RING_INNER, out);
  return out as Partial<BatchConfigSettings>;
}

/* ------------------------------- stroke -------------------------------- */

export function collapseStroke(c: BatchConfigSettings): StrokeConfig {
  const f = asFlat(c);
  return {
    enabled: Boolean(f.strokeEnabled),
    colorEnabled: Boolean(f.strokeColorEnabled),
    color: collapseColor(f, STROKE_COLOR),
    opacityEnabled: Boolean(f.strokeOpacityEnabled),
    opacity: collapseNumeric(f, STROKE_OPACITY),
    widthEnabled: Boolean(f.strokeWidthEnabled),
    width: collapseNumeric(f, STROKE_WIDTH),
  };
}

export function expandStroke(s: StrokeConfig): Partial<BatchConfigSettings> {
  const out: Flat = {
    strokeEnabled: s.enabled,
    strokeColorEnabled: s.colorEnabled,
    strokeOpacityEnabled: s.opacityEnabled,
    strokeWidthEnabled: s.widthEnabled,
  };
  expandColor(s.color, STROKE_COLOR, out);
  expandNumeric(s.opacity, STROKE_OPACITY, out);
  expandNumeric(s.width, STROKE_WIDTH, out);
  return out as Partial<BatchConfigSettings>;
}

/* ----------------------------- whole config ---------------------------- */

/** Collapse the migrated slice of a flat config into the composed view. */
export function collapseBatchConfig(c: BatchConfigSettings): ComposedBatchConfig {
  return {
    sizing: collapseSizing(c),
    shapeParams: collapseShapeParams(c),
    stroke: collapseStroke(c),
  };
}

/**
 * Expand the composed view back over a base flat config. `base` MUST be the current
 * live config: its not-yet-migrated fields flow through untouched. This is what makes
 * incremental strangling safe.
 */
export function expandBatchConfig(
  composed: ComposedBatchConfig,
  base: BatchConfigSettings,
): BatchConfigSettings {
  return {
    ...base,
    ...expandSizing(composed.sizing),
    ...expandShapeParams(composed.shapeParams),
    ...expandStroke(composed.stroke),
  };
}
