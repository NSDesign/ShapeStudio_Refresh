/**
 * mode-value.ts — the keystone of the Batch Config strangler (AR-3).
 *
 * The current `BatchConfigSettings` (shared/schema.ts, ~533 flat fields) repeats
 * ONE pattern ~56 times: a `<name>Mode` discriminator plus its per-mode payload
 * fields. This file models that pattern ONCE as a canonical value, and provides a
 * single generic flat<->composed adapter pair driven by per-field "descriptors",
 * so all ~56 blocks migrate through the same two functions instead of bespoke code.
 *
 * DESIGN CHOICE — lossless record, not a discriminated union.
 * The flat object retains every per-mode value when you switch modes (e.g. it keeps
 * `widthRange` AND `widthValue` AND `widthStartValue` regardless of `widthMode`).
 * To make collapse∘expand a true identity (the invariant the parity test asserts —
 * AR-2) and to preserve the dialog's "switch mode, keep your old numbers" UX, the
 * canonical value carries ALL payloads plus the active `mode`. It is a 1:1 structural
 * regrouping of the flat block, not a lossy projection.
 *
 * Names here are rename-friendly; preserve semantics, not identifiers.
 */

// 'shapeIndex' | 'setRepIndex' — re-declared here so this module is dependency-free;
// import from "@shared/schema" instead once wired into the repo.
export type IncrementalIndexDriver = "shapeIndex" | "setRepIndex";

export interface Modulation {
  enabled: boolean;
  value: number;
}

/** Canonical numeric mode-value. Mirrors a flat block such as width* / rectangleCornerRadius*. */
export interface NumericModeValue {
  mode: "range" | "fixed" | "incremental";
  range: [number, number];
  /** The flat object spells this `…Value` (sizing) or `…Define` (most others); both land here. */
  fixed: number;
  start: number;
  increment: number;
  indexDriver: IncrementalIndexDriver;
  modulation: Modulation;
}

/** Canonical colour mode-value. Mirrors a flat block such as strokeColor* / fillColor*. */
export interface ColorModeValue {
  mode: "range" | "palette" | "define";
  range: [string, string];
  flip: boolean;
  saturation: [number, number];
  lightness: [number, number];
  palette: string[];
  define: string;
}

// ---------------------------------------------------------------------------
// Flat <-> canonical adapters. One descriptor per block; two generic functions.
// ---------------------------------------------------------------------------

type Flat = Record<string, unknown>;

/**
 * Spells out how one numeric block is named in the flat BatchConfigSettings.
 * Write this ONCE per block (see strangler-adapter.ts) and the generic
 * collapse/expand below handle every one of the ~56 blocks identically.
 */
export interface NumericFlatKeys {
  mode: string; // e.g. "rectangleCornerRadiusMode"
  /** What the flat object calls the fixed kind: 'value' (sizing) or 'define' (most others). */
  fixedKind: "value" | "define";
  range: string; // "…Range"
  fixed: string; // "…Value" or "…Define"
  start: string; // "…StartValue"
  increment: string; // "…Increment"
  /** This block's own driver, e.g. "rectangleCornerRadiusIncrementalIndexDriver". */
  indexDriver?: string;
  /** A driver shared across sibling blocks, e.g. width+height share "sizeIncrementalIndexDriver". */
  sharedIndexDriver?: string;
  modulationEnabled?: string; // "…ModulationEnabled"
  modulationValue?: string; // "…ModulationValue"
}

export interface ColorFlatKeys {
  mode: string; // "strokeColorMode"
  range: string; // "strokeColorRange"
  flip: string; // "strokeColorRangeFlip"
  saturation: string; // "strokeColorSaturationRange"
  lightness: string; // "strokeColorLightnessRange"
  palette: string; // "strokeColorPalette"
  define: string; // "strokeColorDefine"
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

export function collapseNumeric(flat: Flat, k: NumericFlatKeys): NumericModeValue {
  const rawMode = flat[k.mode];
  const mode: NumericModeValue["mode"] =
    rawMode === "range" ? "range" : rawMode === "incremental" ? "incremental" : "fixed";
  const driverKey = k.indexDriver ?? k.sharedIndexDriver;
  return {
    mode,
    range: (flat[k.range] as [number, number]) ?? [0, 0],
    fixed: num(flat[k.fixed]),
    start: num(flat[k.start]),
    increment: num(flat[k.increment]),
    indexDriver: (driverKey ? (flat[driverKey] as IncrementalIndexDriver) : "shapeIndex") ?? "shapeIndex",
    modulation: {
      enabled: k.modulationEnabled ? Boolean(flat[k.modulationEnabled]) : false,
      value: k.modulationValue ? num(flat[k.modulationValue]) : 0,
    },
  };
}

/**
 * Writes a canonical numeric value back onto a (partial) flat object, touching ONLY
 * the keys this block owns. Spread the result over the live BatchConfigSettings to
 * update one section without disturbing any other — the core strangler guarantee.
 * All payloads are written (not just the active mode) so the round-trip is lossless.
 */
export function expandNumeric(v: NumericModeValue, k: NumericFlatKeys, out: Flat = {}): Flat {
  out[k.mode] = v.mode === "fixed" ? k.fixedKind : v.mode;
  out[k.range] = v.range;
  out[k.fixed] = v.fixed;
  out[k.start] = v.start;
  out[k.increment] = v.increment;
  if (k.indexDriver) out[k.indexDriver] = v.indexDriver;
  else if (k.sharedIndexDriver) out[k.sharedIndexDriver] = v.indexDriver;
  if (k.modulationEnabled) out[k.modulationEnabled] = v.modulation.enabled;
  if (k.modulationValue) out[k.modulationValue] = v.modulation.value;
  return out;
}

export function collapseColor(flat: Flat, k: ColorFlatKeys): ColorModeValue {
  const rawMode = flat[k.mode];
  const mode: ColorModeValue["mode"] =
    rawMode === "palette" ? "palette" : rawMode === "define" ? "define" : "range";
  return {
    mode,
    range: (flat[k.range] as [string, string]) ?? ["#000000", "#ffffff"],
    flip: Boolean(flat[k.flip]),
    saturation: (flat[k.saturation] as [number, number]) ?? [0, 100],
    lightness: (flat[k.lightness] as [number, number]) ?? [0, 100],
    palette: (flat[k.palette] as string[]) ?? [],
    define: (flat[k.define] as string) ?? "#000000",
  };
}

export function expandColor(v: ColorModeValue, k: ColorFlatKeys, out: Flat = {}): Flat {
  out[k.mode] = v.mode;
  out[k.range] = v.range;
  out[k.flip] = v.flip;
  out[k.saturation] = v.saturation;
  out[k.lightness] = v.lightness;
  out[k.palette] = v.palette;
  out[k.define] = v.define;
  return out;
}
