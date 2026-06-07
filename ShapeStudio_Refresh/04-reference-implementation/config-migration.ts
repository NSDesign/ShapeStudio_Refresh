// =============================================================================
// ShapeStudio — BatchConfigSettings → Composed Config Migration (DRAFT)
// =============================================================================
// Purpose: the concrete bridge for AR-3. Maps the current ~533-field FLAT
// `BatchConfigSettings` onto the composed sub-configs + `ModeValue<T>` from the
// Generation Core Interface, and back, so existing project files / saved
// generation sets keep loading.
//
// Strategy: write `up()` (flat → composed) once, derive `down()` (composed →
// flat) for round-trip safety, and gate the whole thing behind a version bump.
// Field names on the LEFT are the REAL fields in shared/schema.ts; names on the
// RIGHT are the proposed composed shape (rename-friendly).
// =============================================================================

import type {
  GenerationConfig, SizingConfig, EffectsConfig, TransformConfig, ModeValue, IndexDriver,
} from './generation-core-interface'; // the §interface draft

// ----------------------------------------------------------------------------
// 0. The generic collapse — the heart of the migration
// ----------------------------------------------------------------------------
// The flat object expresses ONE logical knob as a *cluster* of sibling fields:
//   <name>Mode: 'range'|'value'|'incremental'   (sometimes 'define' instead of 'value')
//   <name>Range:     [min, max]
//   <name>Value | <name>Define:  T
//   <name>StartValue | <name>Start:  T
//   <name>Increment: T
// `collapseMode` folds any such cluster into a single ModeValue<T>.
//
// It takes the literal field VALUES (already read off the flat object) so it has
// no magic-string coupling to the source object — the call sites below name the
// fields explicitly, which keeps the mapping greppable and type-checked.

type RawMode = 'range' | 'value' | 'define' | 'incremental';

function collapseMode<T extends number | string>(raw: {
  mode: RawMode;
  range?: [T, T];
  value?: T;        // covers both `Value` and `Define` flat fields
  start?: T;        // covers `StartValue` / `Start`
  increment?: T;
}): ModeValue<T> {
  switch (raw.mode) {
    case 'range':
      return { mode: 'range', range: raw.range ?? [raw.value as T, raw.value as T] };
    case 'incremental':
      return { mode: 'incremental', start: (raw.start ?? raw.value) as T, increment: (raw.increment ?? (0 as T)) };
    case 'value':
    case 'define':
    default:
      return { mode: 'value', value: (raw.value ?? raw.start) as T };
  }
}

// Inverse: expand a ModeValue back to the flat cluster (for down-migration /
// writing files older tooling can still read). `defineKey` chooses whether the
// fixed value writes to `<name>Value` or `<name>Define` (some clusters use one).
function expandMode<T extends number | string>(
  m: ModeValue<T>,
  opts: { defineKey?: 'value' | 'define' } = {},
): { mode: RawMode; range: [T, T]; value: T; startValue: T; increment: T } {
  const out = { mode: 'value' as RawMode, range: [0, 0] as unknown as [T, T], value: 0 as unknown as T, startValue: 0 as unknown as T, increment: 0 as unknown as T };
  if (m.mode === 'range') { out.mode = 'range'; out.range = m.range; out.value = m.range[0]; out.startValue = m.range[0]; }
  else if (m.mode === 'incremental') { out.mode = 'incremental'; out.startValue = m.start; out.value = m.start; out.increment = m.increment; }
  else { out.mode = opts.defineKey === 'define' ? 'define' : 'value'; out.value = m.value; out.startValue = m.value; out.range = [m.value, m.value]; }
  return out;
}

// ----------------------------------------------------------------------------
// 1. Minimal view of the legacy flat object (only the fields we map below).
//    The real type is the full BatchConfigSettings; this subset keeps the draft
//    readable. Field names are verbatim from shared/schema.ts.
// ----------------------------------------------------------------------------
interface LegacyBatchConfigSubset {
  // size cluster
  widthMode: 'range' | 'value' | 'incremental';
  widthRange: [number, number]; widthValue: number; widthStartValue: number; widthIncrement: number;
  heightMode: 'range' | 'value' | 'incremental';
  heightRange: [number, number]; heightValue: number; heightStartValue: number; heightIncrement: number;
  sizeConstraintMode: 'none' | 'min' | 'max' | 'avg';
  sizeIncrementalIndexDriver: IndexDriver;
  widthModulationEnabled: boolean; widthModulationValue: number;
  heightModulationEnabled: boolean; heightModulationValue: number;
  widthRandomizationScale: number; heightRandomizationScale: number;

  // blur cluster (note: uses 'define', not 'value')
  blurEnabled: boolean; blurProbability: number;
  blurMode: 'range' | 'define' | 'incremental';
  blurRange: [number, number]; blurDefine: number; blurStartValue: number; blurIncrement: number;
  blurModulationEnabled: boolean; blurModulationValue: number;
  blurIncrementalIndexDriver: IndexDriver;

  // rotation cluster (part of transform)
  rotationMode: 'range' | 'value' | 'incremental';
  rotationRange: [number, number]; rotationValue: number; rotationIncrement: number;

  // …all other clusters map by the same pattern…
  [k: string]: unknown;
}

// ----------------------------------------------------------------------------
// 2. UP migration: flat → composed (worked examples for 3 representative groups)
// ----------------------------------------------------------------------------

function migrateSizing(f: LegacyBatchConfigSubset): SizingConfig {
  return {
    width: collapseMode<number>({
      mode: f.widthMode, range: f.widthRange, value: f.widthValue,
      start: f.widthStartValue, increment: f.widthIncrement,
    }),
    height: collapseMode<number>({
      mode: f.heightMode, range: f.heightRange, value: f.heightValue,
      start: f.heightStartValue, increment: f.heightIncrement,
    }),
    constraint: f.sizeConstraintMode,
    // modulation + randomization survive as their own small fields on the sub-config
    indexDriver: f.sizeIncrementalIndexDriver,
    modulation: {
      width:  { enabled: f.widthModulationEnabled,  value: f.widthModulationValue },
      height: { enabled: f.heightModulationEnabled, value: f.heightModulationValue },
    },
    randomizationScale: { width: f.widthRandomizationScale, height: f.heightRandomizationScale },
  } as SizingConfig; // SizingConfig in the interface draft is a stub — extend it with these named fields
}

function migrateEffects(f: LegacyBatchConfigSubset): EffectsConfig {
  return {
    blur: {
      enabled: f.blurEnabled,
      probability: f.blurProbability,
      // IMPORTANT: blur uses `blurDefine` for its fixed value, not `blurValue`.
      radius: collapseMode<number>({
        mode: f.blurMode, range: f.blurRange, value: f.blurDefine,
        start: f.blurStartValue, increment: f.blurIncrement,
      }),
      indexDriver: f.blurIncrementalIndexDriver,
      modulation: { enabled: f.blurModulationEnabled, value: f.blurModulationValue },
    },
    // dropShadow/outerGlow/innerShadow/innerGlow: same collapseMode treatment for
    // each offsetX/offsetY/blur/spread cluster — elided here for length.
  } as EffectsConfig; // extend EffectsConfig stub with indexDriver/modulation as above
}

function migrateTransform(f: LegacyBatchConfigSubset): Pick<TransformConfig, 'rotation'> {
  return {
    rotation: collapseMode<number>({
      mode: f.rotationMode, range: f.rotationRange, value: f.rotationValue,
      increment: f.rotationIncrement,
    }),
    // scaleX/scaleY + origin/align fields collapse the same way.
  };
}

// Top-level up(): assemble the full composed GenerationConfig from the flat one.
export function migrateBatchConfigUp(flat: LegacyBatchConfigSubset /* = full BatchConfigSettings */): Partial<GenerationConfig> {
  return {
    sizing: migrateSizing(flat),
    effects: migrateEffects(flat),
    transform: { ...(migrateTransform(flat) as TransformConfig) },
    // position, shapeParams, fill, stroke, echo, harmony, distribution:
    //   each its own migrate<Group>() built on collapseMode — same shape as above.
  };
}

// ----------------------------------------------------------------------------
// 3. DOWN migration: composed → flat (round-trip, for backward-compatible saves)
// ----------------------------------------------------------------------------

export function migrateSizingDown(s: SizingConfig): Partial<LegacyBatchConfigSubset> {
  const w = expandMode<number>(s.width);
  const h = expandMode<number>(s.height);
  return {
    widthMode: w.mode as LegacyBatchConfigSubset['widthMode'], widthRange: w.range, widthValue: w.value, widthStartValue: w.startValue, widthIncrement: w.increment,
    heightMode: h.mode as LegacyBatchConfigSubset['heightMode'], heightRange: h.range, heightValue: h.value, heightStartValue: h.startValue, heightIncrement: h.increment,
    sizeConstraintMode: s.constraint,
  };
}
// (blur uses defineKey:'define': expandMode(e.radius, { defineKey: 'define' }) → blurDefine)

// ----------------------------------------------------------------------------
// 4. Versioned dispatch — call on load, before validation
// ----------------------------------------------------------------------------
// EnhancedBatchConfig.version already exists for exactly this. Bump it when the
// composed shape ships; route old payloads through up() first.

export const COMPOSED_CONFIG_VERSION = '2.0.0';

export function loadConfig(raw: { version?: string } & Record<string, unknown>): Partial<GenerationConfig> {
  const v = raw.version ?? '1.0.0';
  if (v.startsWith('1.')) {
    // legacy flat → run prior in-repo normalisers FIRST (they fix even older shapes),
    // then collapse into the composed form.
    //   raw = migrateSizeConstraintMode(raw);     // existing helper
    //   raw = migrateBatchConfigSettings(raw);    // existing helper
    return migrateBatchConfigUp(raw as unknown as LegacyBatchConfigSubset);
  }
  return raw as unknown as Partial<GenerationConfig>; // already composed
}

// =============================================================================
// Migration coverage checklist (every flat cluster → its composed home)
//   size:        width*/height* + sizeConstraintMode      → sizing
//   position:    x/yPosition* + *Modulation*              → position
//   per-type:    rectangleCornerRadius*, starInnerRadius*,
//                ringInnerRadius*, segmentCount*, point*,  → shapeParams
//                spline*
//   fill:        fillColor* / fillGradient* / fillOpacity* → fill
//   stroke:      strokeColor*/strokeOpacity*/strokeWidth*  → stroke
//   effects:     blur*, dropShadow*, outerGlow*,           → effects
//                innerShadow*, innerGlow*
//   transform:   x/yTransform*, scaleX/Y*, rotation*,      → transform
//                transformOrigin*, *Anchor*, skew*
//   echo:        echo* (already a sub-object in echoUtils) → echo
//   harmony:     colorHarmony* + harmony*                  → harmony
//   distribution:distributionLayout, grid*, wave*,         → distribution
//                ellipse*, spiral*, sort*, masking*, cell*
//   DROP (do not migrate): evolutionMode (disabled), physics* (incomplete),
//                          any legacy useMin/Max/AvgWidthHeight (already
//                          normalised by migrateSizeConstraintMode).
// =============================================================================
