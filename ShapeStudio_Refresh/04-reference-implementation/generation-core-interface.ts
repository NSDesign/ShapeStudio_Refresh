// =============================================================================
// ShapeStudio — Generation Core Interface (DRAFT)
// =============================================================================
// Purpose: the single, runtime-agnostic boundary that AR-1 calls for.
// Place this in `shared/core/`. Both the browser and the Node server import it.
// It contains NO DOM, NO `canvas`, NO React — only pure functions and data.
//
// The contract: given a configuration, a seed, and an index, the core produces
// a fully-resolved, serialisable description of a shape (geometry + paint).
// A *renderer* (per runtime) is the ONLY thing that knows how to draw that
// description onto a surface. Same core → identical descriptions → parity.
//
// Names are illustrative and may be renamed in a rebuild; the boundary is the
// point. Types are grounded in the current codebase (Point/Transform are the
// real shapes from client/src/lib/shapeTypes.ts).
// =============================================================================

// ----------------------------------------------------------------------------
// 0. Primitives (already exist in the codebase — hoist them into shared/)
// ----------------------------------------------------------------------------

export interface Point { x: number; y: number; }

export interface Transform {
  x: number; y: number;
  scaleX: number; scaleY: number;
  rotation: number;          // radians
  skewX: number; skewY: number;
}

export type SupportedShapeType =
  | 'rectangle' | 'rounded-rectangle' | 'square' | 'rounded-square'
  | 'circle' | 'ellipse' | 'semicircle' | 'ring'
  | 'triangle' | 'right-triangle' | 'trapezoid' | 'pentagon' | 'hexagon'
  | 'rhombus' | 'parallelogram' | 'kite'
  | 'heart' | 'arrow' | 'cross'
  | 'line' | 'line-vector'
  | 'polygon' | 'star' | 'chunk' | 'blob'
  | 'cubic' | 'bezier' | 'smooth-spline'
  | 'spline-circle' | 'spline-ellipse' | 'spline-ring';

export type BlendMode =
  | 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference'
  | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export type CompositingOperation =
  | 'source-over' | 'source-in' | 'source-out' | 'source-atop'
  | 'destination-over' | 'destination-in' | 'destination-out' | 'destination-atop'
  | 'lighter' | 'copy' | 'xor';

// ----------------------------------------------------------------------------
// 1. THE mode primitive (AR-3)
// ----------------------------------------------------------------------------
// Replaces the ~hundreds of hand-written `xMode: 'range'|'value'|'incremental'`
// + `xRange`/`xValue`/`xStart`/`xIncrement` field clusters in BatchConfigSettings
// with one reusable, type-safe union. Resolved by `resolveMode` (§4).

export type ModeValue<T = number> =
  | { mode: 'value'; value: T }
  | { mode: 'range'; range: [T, T] }
  | { mode: 'incremental'; start: T; increment: T };

// Which index drives an `incremental` progression (mirrors IncrementalIndexDriver).
export type IndexDriver = 'shapeIndex' | 'setRepIndex';

// ----------------------------------------------------------------------------
// 2. Resolved output — what the core PRODUCES (serialisable; no canvas)
// ----------------------------------------------------------------------------
// A renderer consumes ONLY this. If two runtimes produce equal GeneratedShape[]
// for the same input, parity holds by construction (this is what AR-2 asserts).

export interface Paint {
  fill?: FillSpec;
  stroke?: StrokeSpec;
  opacity: number;                 // 0..1
  blendMode: BlendMode;
  compositingOperation: CompositingOperation;
  effects: EffectSpec[];           // blur / drop-shadow / glow / inner-* (see §2.1)
}

export type FillSpec =
  | { kind: 'solid'; color: string }                         // hex/hsl string
  | { kind: 'linear'; stops: GradientStop[]; angle: number } // radians
  | { kind: 'radial'; stops: GradientStop[]; center: Point; radius: number; shape: 'circle' | 'ellipse' }
  | { kind: 'conic';  stops: GradientStop[]; center: Point; startAngle: number };

export interface GradientStop { offset: number; color: string; } // offset 0..1

export interface StrokeSpec { color: string; width: number; opacity: number; }

// 2.1 Effects are DATA, not draw calls. The renderer interprets them.
//     NOTE: this is exactly where shadow/glow parity is fixed — both the
//     browser and server renderers consume the same EffectSpec list.
export type EffectSpec =
  | { kind: 'blur'; radius: number }
  | { kind: 'drop-shadow'; color: string; offset: Point; blur: number; spread: number; blendMode: 'multiply' | 'darken' | 'overlay' }
  | { kind: 'outer-glow';  color: string; blur: number; spread: number; blendMode: 'screen' | 'add' | 'soft-light' | 'color-dodge' | 'lighter' }
  | { kind: 'inner-shadow'; color: string; offset: Point; blur: number; blendMode: 'multiply' | 'darken' | 'overlay' }
  | { kind: 'inner-glow';  color: string; blur: number; spread: number; blendMode: 'screen' | 'add' | 'soft-light' | 'color-dodge' | 'lighter' };

// The fully-resolved shape. `points` is the geometry in LOCAL space; `transform`
// places it in world/artboard space. `closed` distinguishes lines/open splines.
export interface GeneratedShape {
  id: string;
  type: SupportedShapeType;
  points: Point[];                 // local-space geometry (already regenerated)
  closed: boolean;
  controlPoints?: Point[];         // for bezier/cubic/spline families
  transform: Transform;
  paint: Paint;
  zIndex: number;
  echoes?: GeneratedShape[];       // pre-resolved echo trail (see §3, optional)
  meta?: Record<string, number | string | boolean>; // debug/provenance only
}

// ----------------------------------------------------------------------------
// 3. Input — the composed configuration (AR-3) the core CONSUMES
// ----------------------------------------------------------------------------
// Each sub-config is its own type with its own defaults + Zod schema, assembled
// here. Bodies are elided (`/* … */`) — the point is the *shape* of the input,
// not every field. These replace the 533-field flat BatchConfigSettings.

export interface GenerationConfig {
  shapeTypes: SupportedShapeType[];     // which primitives may be produced
  count: ModeValue<number>;             // shape count for this set
  indexDriver: IndexDriver;

  sizing: SizingConfig;                 // width/height + constraint (none|min|max|avg)
  position: PositionConfig;             // x/y modes + grid-aware modulation
  shapeParams: ShapeParamsConfig;       // per-type: corner radius, star inner-r, segments…
  fill: FillConfig;                     // solid / linear|radial|conic + harmony hook
  stroke: StrokeConfig;
  effects: EffectsConfig;               // blur + drop-shadow/glow/inner-* (all here)
  transform: TransformConfig;           // scale/rotate/translate/skew + origin + align
  echo: EchoConfig;                     // motion-trail spec (shared/echoUtils today)
  harmony: HarmonyConfig;               // colour-harmony override
  distribution: DistributionConfig;     // grid|wave|ellipse|spiral|auto + sort + masking
}

// Placeholder bodies — define fully per Appendices B–D, each built on ModeValue<T>.
export interface SizingConfig       { width: ModeValue; height: ModeValue; constraint: 'none' | 'min' | 'max' | 'avg'; /* … */ }
export interface PositionConfig     { x: ModeValue; y: ModeValue; xModulation: 'off' | 'grid-col' | 'pixel-value' | 'shape-count'; yModulation: 'off' | 'grid-row' | 'pixel-value' | 'shape-count'; /* … */ }
export interface ShapeParamsConfig  { cornerRadius?: ModeValue; starInnerRadius?: ModeValue; ringInnerRadius?: ModeValue; segmentCount?: ModeValue; /* …per-type… */ }
export interface FillConfig         { enabled: boolean; probability: number; /* solid/gradient selection + ModeValue colour controls */ }
export interface StrokeConfig       { enabled: boolean; probability: number; width: ModeValue; opacity: ModeValue; /* … */ }
export interface EffectsConfig      { blur?: { enabled: boolean; probability: number; radius: ModeValue }; dropShadow?: { enabled: boolean; /* … */ }; outerGlow?: { enabled: boolean; /* … */ }; innerShadow?: { enabled: boolean; /* … */ }; innerGlow?: { enabled: boolean; /* … */ }; }
export interface TransformConfig    { scaleX: ModeValue; scaleY: ModeValue; rotation: ModeValue; origin: 'define' | 'predefined-artboard' | 'current-shape' | 'shape-reference'; /* … */ }
export interface EchoConfig         { enabled: boolean; count: number; scope: 'set' | 'shape' | 'both'; /* …EchoSpreadConfig… */ }
export interface HarmonyConfig      { enabled: boolean; /* scheme + base + ModeValue HSL */ }
export interface DistributionConfig { pattern: 'grid' | 'wave' | 'ellipse' | 'spiral' | 'auto-distribute'; sort?: { key: string; order: 'asc' | 'desc'; scope: 'per-generation' | 'per-batch' }; grid?: GridConfig; masking?: MaskingConfig; /* … */ }
export interface GridConfig         { /* spacing modes, offsets, cell constraints — Appendix C */ }
export interface MaskingConfig      { /* grid-position filter — Appendix C.4 */ }

// Artboard/global context the core needs but does not own.
export interface GenerationContext {
  artboard: { x: number; y: number; width: number; height: number; backgroundColor: string; dpi: number };
  setRepIndex: number;             // which repetition of the set we're generating
  zIndexBase: number;              // assigned by the multi-set composer
}

// ----------------------------------------------------------------------------
// 4. THE CORE API — pure functions, no side effects
// ----------------------------------------------------------------------------

// Deterministic RNG. Same seed ⇒ same stream. The ONLY source of randomness in
// the core; renderers never call Math.random. Reproducibility (AR-2) depends on
// every "random" pull going through this.
export interface Rng {
  next(): number;                  // [0,1)
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  fork(label: string): Rng;        // child stream for independent sub-decisions
}
export function createRng(seed: number): Rng { /* xorshift/mulberry32 — impl in core */ return undefined as unknown as Rng; }

// Resolve a ModeValue to a concrete value for a given index. The single function
// that interprets value/range/incremental — replaces logic scattered today
// across batchConfigProcessor (server) and shapeTypes/useShapeEditor (client).
export function resolveMode<T extends number>(m: ModeValue<T>, ctx: { index: number; rng: Rng }): T { return undefined as unknown as T; }

// Build local-space geometry for one shape type at a given size. Pure geometry,
// no paint, no transform. This is the function the server currently re-derives.
export function generateGeometry(
  type: SupportedShapeType,
  size: { width: number; height: number },
  params: ShapeParamsConfig,
  ctx: { index: number; rng: Rng },
): { points: Point[]; closed: boolean; controlPoints?: Point[] } { return undefined as unknown as never; }

// Resolve paint (fill/stroke/opacity/blend/compositing/effects) for one shape.
export function resolvePaint(
  config: GenerationConfig,
  ctx: { index: number; rng: Rng; baseColor?: string },
): Paint { return undefined as unknown as Paint; }

// Generate ONE fully-resolved shape (geometry + transform + paint + echoes).
// This is the atomic unit; `generateShapes` composes it.
export function generateShape(
  config: GenerationConfig,
  context: GenerationContext,
  index: number,
  rng: Rng,
): GeneratedShape { return undefined as unknown as GeneratedShape; }

// Generate a whole set: resolves count, runs the pipeline per shape in the
// canonical order (size → harmony → fill/stroke → blur → transforms → noise →
// blend/compositing → distribution layout → sort), applies masking, echoes,
// and z-index. Deterministic given (config, seed, context).
export function generateShapes(
  config: GenerationConfig,
  context: GenerationContext,
  seed: number,
): GeneratedShape[] { return undefined as unknown as GeneratedShape[]; }

// Multi-set composition: order sets, assign z-index bands, apply per-set
// transform/visibility/blend, honour edge-case strategy when sets < batchCount.
export interface GenerationSetInput { id: string; enabled: boolean; order: number; config: GenerationConfig; /* set-level fields */ }
export function composeSets(
  sets: GenerationSetInput[],
  global: { context: GenerationContext; edgeCaseStrategy: 'hold' | 'cycle' | 'random' | 'stop'; batchCount: number },
  seed: number,
): GeneratedShape[] { return undefined as unknown as GeneratedShape[]; }

// ----------------------------------------------------------------------------
// 5. THE RENDERER BOUNDARY — implemented PER RUNTIME, never in the core
// ----------------------------------------------------------------------------
// The core hands a renderer a GeneratedShape[]; the renderer draws it. The
// browser implements this over CanvasRenderingContext2D; the server over
// node-canvas / Sharp. Effects, gradients, blend modes are interpreted here —
// once per runtime — instead of generation logic being duplicated per runtime.

export interface RenderSurface {
  readonly width: number;
  readonly height: number;
  // minimal 2D drawing ops the renderer needs; satisfied by both runtimes.
}

export interface ShapeRenderer {
  render(shapes: GeneratedShape[], surface: RenderSurface, opts?: { background?: string; includeAdornments?: boolean }): void;
}

// Browser:  class CanvasShapeRenderer implements ShapeRenderer { /* uses ctx2d */ }
// Server:   class NodeShapeRenderer  implements ShapeRenderer { /* node-canvas + sharp */ }

// ----------------------------------------------------------------------------
// 6. PARITY HARNESS — what AR-2's CI test calls
// ----------------------------------------------------------------------------
// Because generateShapes is pure and serialisable, parity is a deep-equality
// check on its output — no rendering required for the structural half of the
// test. A second stage rasterises via each ShapeRenderer and diffs pixels.

export function serializeForParity(shapes: GeneratedShape[]): string {
  // stable stringify: sort keys, round floats to a fixed precision so platform
  // FP noise doesn't cause false negatives. Implementation lives in core.
  return JSON.stringify(shapes);
}

// In the test: for each fixture { config, seed }:
//   const a = serializeForParity(generateShapes(config, ctx, seed)); // "client" core
//   const b = serializeForParity(generateShapes(config, ctx, seed)); // "server" core
//   expect(a).toEqual(b);                       // same core → trivially true,
//   // …and stays true even when only ONE implementation exists (the goal).
// Then rasterise via CanvasShapeRenderer vs NodeShapeRenderer and assert the
// pixel diff is within tolerance.

// =============================================================================
// Why this boundary fixes the verified problems
//   • AR-1: generation lives once, in shared/. Renderers are thin + runtime-only.
//           Kills the ~3,700 lines of server duplication and the server→client
//           type import.
//   • AR-2: generateShapes is pure + serialisable ⇒ parity is a unit assertion,
//           not a manual eyeball. Shadow/glow can no longer diverge: both
//           renderers consume the same EffectSpec[].
//   • AR-3: every numeric knob is ModeValue<T>; config is composed sub-objects.
//   • Reproducibility: all randomness flows through one seeded Rng.
// =============================================================================
