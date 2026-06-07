/**
 * batch-config-sections.ts — composed sub-config types (AR-3).
 *
 * Decomposes the flat ~533-field `BatchConfigSettings` into independently-typed,
 * independently-validatable sections, each built on the canonical ModeValue
 * primitives. Three sections are fully modelled here (sizing, shapeParams, stroke)
 * to prove the pattern end-to-end (types -> adapter -> panel). The remaining
 * sections are scaffolded with their exact `shared/schema.ts` line ranges so they
 * can be migrated one at a time using the identical descriptor approach.
 *
 * Serialised keys are NOT changed — the adapter (strangler-adapter.ts) maps these
 * composed shapes back to the existing flat field names, so existing project files
 * and the current generator keep working untouched during migration.
 */

import type { NumericModeValue, ColorModeValue } from "./mode-value";

/* ========================= IMPLEMENTED SECTIONS ========================= */

/** Sizing — flat block ≈ schema.ts L1029–1062 (width*/height*, sizeConstraintMode, min/max). */
export interface SizingConfig {
  /** shapePropertiesDimensionsEnabled */
  enabled: boolean;
  width: NumericModeValue;
  height: NumericModeValue;
  /** sizeConstraintMode — when not 'none', both dims take the min/max/avg (squares/circles). */
  constraint: "none" | "min" | "max" | "avg";
  /** sizeIncrementalResetPerBatch */
  incrementalResetPerBatch: boolean;
  minimumSize: number;
  maximumSize: number;
}

/** Per-shape-type params — flat blocks ≈ schema.ts L1112–1141 (+ polygon/line/spline lower down). */
export interface ShapeParamsConfig {
  rectangleCornerRadius: NumericModeValue;
  starInnerRadius: NumericModeValue;
  ringInnerRadius: NumericModeValue;
  // TODO migrate (same NumericModeValue pattern):
  //   polygon segment count, line point-count / point-position,
  //   spline point-count / point-position / control-point modes.
}

/** Stroke — flat block ≈ schema.ts L436–468 (colour / opacity / width, each independently enabled). */
export interface StrokeConfig {
  enabled: boolean; // strokeEnabled
  colorEnabled: boolean; // strokeColorEnabled
  color: ColorModeValue;
  opacityEnabled: boolean; // strokeOpacityEnabled
  opacity: NumericModeValue;
  widthEnabled: boolean; // strokeWidthEnabled
  width: NumericModeValue;
}

/* ========================= COMPOSED CONTAINER ========================= */

/**
 * The composed view of BatchConfigSettings. Migrated sections are concrete; the
 * commented sections are the remaining work, annotated with where they live in
 * shared/schema.ts. Add each as it is migrated; the adapter merges everything back
 * onto the flat object, so partial migration is always safe.
 */
export interface ComposedBatchConfig {
  sizing: SizingConfig;
  shapeParams: ShapeParamsConfig;
  stroke: StrokeConfig;

  // --- not yet migrated (build with the same descriptor pattern) ---
  // distribution: DistributionConfig;  // L935–1003: pattern + grid/wave/ellipse/spiral; plus the already-nested
  //                                     //            gridOffsets / shapeMasking / cellConstraints objects.
  // position: PositionConfig;          // L1064–1110: SPECIAL — adds 'directional' kind and grid-aware modulation
  //                                     //            ('off'|'grid-col'|'pixel-value'|'shape-count'); needs a bespoke
  //                                     //            PositionModeValue + descriptor, not the generic NumericModeValue.
  // fill: FillConfig;                  // L1142–~1360: solid colour (ColorModeValue) + linear/radial/conic gradients
  //                                     //            (each centre X/Y is a NumericModeValue) + opacity.
  // effects: EffectsConfig;            // blur (NumericModeValue) + dropShadow/outerGlow/innerShadow/innerGlow,
  //                                     //            each = offset/blur/spread NumericModeValues + colorMode + blendMode.
  // transform: TransformConfig;        // scale/rotation/position-transform NumericModeValues + transform-origin.
  // generation: GenerationCountConfig; // generationCount* (NumericModeValue-like) + reset/modulation.
  // blend: BlendConfig;                // blendModeEnabled + weighted enabledBlendModes / enabledCompositingOperations.
  // preset: string;                    // selectedPreset
}
