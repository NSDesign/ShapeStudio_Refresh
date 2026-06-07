# Appendix B — Generation System & Configuration Schema

The heart of ShapeStudio. Covers single vs multi-set generation, the generation-set data model, the central `BatchConfigSettings` object, and the exact pipeline order. All schema names may be renamed in a rebuild; semantics must be preserved.

---

## B.1 Two generation modes

`EnhancedBatchConfig.mode` selects:
- **Single** — one configuration generates one composition (`legacyBatchConfig`).
- **Multi** — an array of **generation sets** compose into one composition with global ordering/z-index/repetition.

`EnhancedBatchConfig` (top-level container):
```ts
interface EnhancedBatchConfig {
  mode: GenerationSetMode;                 // SINGLE | MULTI (enum)
  legacyBatchConfig?: BatchConfigSettings; // used when SINGLE
  generationSets: GenerationSet[];         // used when MULTI

  globalSettings: {
    canvasWidth: number; canvasHeight: number;
    artboardSettings?: { enabled: boolean; width: number; height: number; backgroundColor: string };
    edgeCaseStrategy: 'hold' | 'cycle' | 'random' | 'stop'; // when sets < batch count
    exportFormat: 'png' | 'jpeg' | 'webp' | 'avif' | 'bmp';
    exportQuality: number;                 // 0–100
    globalZIndexSettings: {
      startingZIndex: number; setSpacing: number;
      preventOverlap: boolean; useGlobalSettings: boolean; // if true, ignore per-set zIndexConfig
    };
    globalRepetitionSettings: {
      repetitionMode: 'fixed' | 'range';
      repetitionValue: number; repetitionRange: [number, number];
    };
  };

  modeRestrictions: {
    multiGenerationOnlyForFixedCount: boolean;
    maxGenerationSets: number; minShapesPerSet: number; maxShapesPerSet: number;
  };

  createdAt: string; updatedAt: string;    // ISO strings (JSON-serialisable)
  version: string;                          // for migration
}
```

## B.2 The generation set

A `GenerationSet` is a complete, self-contained recipe. Multiple sets are generated in `generationOrder` and layered by z-index.

```ts
interface GenerationSet {
  id: string; name: string; enabled: boolean;

  enabledShapeTypes: SupportedShapeType[];          // which primitives this set may produce
  shapeCountMode: ShapeCountMode;                    // FIXED | RANGE (enum)
  shapeCountFixed: number; shapeCountRange: [number, number];

  shapeSpecificProperties: ShapeSpecificProperties;  // per-type params (Appendix A.4)
  zIndexConfig: ZIndexConfig;                        // per-set layering (overridden by global if enabled)
  batchConfig: BatchConfigSettings;                  // the full recipe (B.3)

  // set-level composition controls
  setVisibility: { visible: boolean; opacity: number; opacityVariance: number };
  setBlendMode: BlendMode;
  compositingOperation: CompositingOperation;
  setTransform: { x; y; rotation; scaleX; scaleY; transformOrigin };
  artboardAlignment: {                               // fit & align the whole set
    fitToArtboard: boolean; fitTarget: 'none'|'artboard'|'bleed'; fitMode: 'contain'|'fill';
    alignTo: 'artboard'|'set'|'none'; alignmentType: /* 9-point */ string;
    targetSetId?: string; margin: number | {top;bottom;left;right};
  };

  generationOrder: number; description?: string;

  repetitionMode: 'use-global' | 'fixed' | 'range';  // per-set repetition override
  repetitionValue: number; repetitionRange: [number, number];

  locks: SetLocks;                                   // granular operation locks (e.g. composite)
  echoOverride?: { enabled: boolean; config?: EchoSpreadConfig }; // Appendix D
}
```

Defaults and limits: `DEFAULT_Z_INDEX_CONFIG`, `DEFAULT_GENERATION_SET_LIMITS`, and `GenerationSetUtils` helpers exist in `shared/schema.ts` and should be reproduced.

## B.3 `BatchConfigSettings` — the central recipe

A single large object (the `BatchConfigSettings` interface; `defaultBatchConfigSettings` provides defaults) controls almost every visual behaviour. The pervasive design pattern is a **mode field + parameters per mode**, typically:
- `range` → `[min, max]`
- `value` / `define` → fixed value
- `incremental` → `{ startValue, increment }` driven by an index (shape index or set-repetition index)

Field groups (each is a coherent sub-feature):

1. **Preset selection** — named preset shortcut.
2. **Distribution layout** — see Appendix C. Pattern + grid/wave/ellipse/spiral parameters, sort, randomization, grid offsets, shape masking, cell constraints.
3. **Generation count** — `generationCountMode: range|fixed|incremental`.
4. **Blend mode** & **compositing operation** controls (probabilistic selection — see B.5).
5. **Shape properties (size)**:
   - `widthMode`/`heightMode`: `range|value|incremental`.
   - `sizeConstraintMode`: `none|min|max|avg` (when active, both dimensions take the min/max/avg → squares/circles at that size). *Replaced an older checkbox + "Force 1:1" system; migrated via `migrateSizeConstraintMode`.*
6. **Position**:
   - `xPositionMode`/`yPositionMode`: `range|value|directional|incremental`.
   - `positionDirectionalMode`: `outward-center|outward-edge|angle-based`.
   - **Position modulation** (grid-aware): `xPositionModulationMode: off|grid-col|pixel-value|shape-count`, `yPositionModulationMode: off|grid-row|...` — `grid-col`/`grid-row` reset incremental progressions at each column/row (fixes incremental-on-grid wrapping; resolved via `positionModulationResolver`).
7. **Per-shape-type properties** — rectangle corner-radius, star inner-radius, ring inner-radius, polygon segment count, line point count/position, spline point/control modes (all `range|define|incremental`).
8. **Fill** (Appendix D.2): solid vs gradient; solid `fillColorMode: range|palette|define` (+ HSL range controls + `fillOpacityMode`); gradient linear/radial/conic with per-type probabilities, colour mode, stops mode/distribution, direction/center/angle controls.
9. **Stroke** — `strokeColorMode: range|palette|define`, `strokeOpacityMode`, `strokeWidthMode` (each with probability gating).
10. **Blur** + **shadow/glow** effects (Appendix D.1) — each with `*Mode: range|define|incremental` and probability.
11. **Transforms** (B.6).
12. **Echo / Motion Trails** (Appendix D.3).
13. **Colour harmony** (Appendix D.2).

> **Probability gating:** most optional properties have a `*Probability` (0–100%) controlling per-shape application, plus master enable toggles (`propertiesEnabled`, `shapePropertiesEnabled`, `colorHarmonyEnabled`, `blurEnabled`, `transformsEnabled`, etc.). Reproduce these toggles — they gate whole branches of the pipeline.

## B.4 Generation pipeline (exact order)

From `docs/client-shape-generation-complete-reference.md`, verified against `shapeGenerator`/`batchConfigProcessor`. Per shape:

1. **Construct** — `new Shape(type, x, y, batchConfig)`: initial position (from distribution/config), minimal-or-random base properties, generate geometry.
2. **Size** (if `propertiesEnabled && shapePropertiesEnabled`) — compute width/height from mode, apply `sizeConstraintMode`, apply to shape, **then `regenerateShapePoints()`** (mandatory).
3. **Colour harmony** (if enabled) — overrides fill/stroke/gradient colours with harmony colours.
4. **Fill & stroke** (if `propertiesEnabled && !colorHarmonyEnabled`) — solid vs gradient by probability; generate colour/opacity per mode; stroke gated by probability.
5. **Blur** (if enabled) — by probability, value from mode.
6. **Transforms** (if enabled) — origin → scale → rotate → translate(+delta) → skew → additive rotation randomisation.
7. **Noise** (if enabled) — additive per-index noise to position/rotation/scale/opacity/blur and (if not colour-harmony) colour, with modes Randomise (absolute) / Perlin (additive) / other.
8. **Blend / compositing** (independent of `propertiesEnabled`) — probabilistic selection by weights.
9. **Distribution layout** (if enabled) — grid/wave/ellipse/spiral placement, sorting, randomization offsets.

A rebuild must keep this order; several steps depend on earlier ones (notably size→regenerate→render, and harmony before fill).

## B.5 Blend modes & compositing

- `BlendMode` (16): `source-over, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity`.
- `CompositingOperation` (11): `source-over, source-in, source-out, source-atop, destination-over, destination-in, destination-out, destination-atop, lighter, copy, xor` — used for masking/compositing effects.
- Both are selectable per-set and can be applied per-shape via probability weights during generation.

## B.6 Transforms (detail)

- Position transform modes: `xTransformMode/yTransformMode: range|value|incremental|align`. `align` mode uses shape-anchor + artboard-anchor (each `predefined|define`) for precise placement.
- Scale: `scaleXMode/scaleYMode: range|value|incremental`.
- Rotation: `rotationMode: range|value|incremental`.
- Transform origin: `transformOriginMode: define|predefined-artboard|current-shape|shape-reference`, with sub-modes for `define` (`fixed|range|incremental`).
- Transform randomisation scaling (0–100%) applied additively.

## B.7 Seeded randomness & reproducibility

All "random" choices are deterministic given the configuration + index, so a recipe regenerates the same composition. `IncrementalIndexDriver` (`shapeIndex | setRepIndex`) determines whether incremental progressions advance per shape or per set repetition. Preserve deterministic generation — it underpins both reproducibility and client/server parity.
