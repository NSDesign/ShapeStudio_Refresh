# Appendix D — Effects, Colour & Echo / Motion Trails

Per-shape visual effects, the colour systems, and the echo/motion-trails feature. Each item below is implemented; one important parity caveat is flagged.

---

## D.1 Shape effects

All effects are configured on `BatchConfigSettings` with the standard mode pattern (`range|define|incremental`) and a probability gate, plus a master toggle.

**Gaussian blur — ✅ implemented, full client + server parity.**
- `client/src/lib/shapes.ts › renderWithCanvasBlur()` (three-pass box-blur approximation of a Gaussian); mirrored server-side in `server/lib/batchConfigProcessor.ts` / `canvasRenderer.ts`.
- Config: `blurEnabled`, `blurProbability` (0–100), `blurMode: range|define|incremental`, `blurRange`, `blurDefine`, `blurIncremental {startValue, increment}`.
- Render process: render shape to temp canvas → expand bounds for spread → 3-pass box blur (H→V→H) → composite back.

**Drop shadow / Outer glow / Inner shadow / Inner glow — ✅ implemented in the client renderer.**
- `client/src/lib/shapes.ts` implements `renderDropShadow()`, `renderOuterGlow()`, `renderInnerShadow()`, `renderInnerGlow()`, gated by `dropShadow?.enabled` / `outerGlow?.enabled` / `innerShadow?.enabled` / `innerGlow?.enabled`.
- Config groups on `BatchConfigSettings` (each with offset/blur/spread modes + colour mode + blend mode):
  - Drop shadow: `dropShadowColorMode: auto|custom`, `dropShadowBlendMode: multiply|darken|overlay`, offset X/Y, blur, spread (each `range|define|incremental`).
  - Outer glow: `outerGlowColorMode: auto|custom`, `outerGlowBlendMode: screen|add|soft-light|color-dodge|lighter`, blur, spread.
  - Inner shadow: `innerShadowColorMode: auto|custom`, `innerShadowBlendMode: multiply|darken|overlay`, offset X/Y, blur.
  - Inner glow: `innerGlowColorMode: auto|custom`, `innerGlowBlendMode: screen|add|soft-light|color-dodge|lighter`, blur, spread.
- `auto` colour mode derives the effect colour from the shape's own colour.

> **⚠ Parity caveat (code-verified):** shadow/glow render in the **client** (preview + standard client export) but were **not found in the server render path** — only blur appears in `server/lib`. So in the current app, server-side high-resolution export does **not** include shadow/glow. The in-repo docs (`future-features.md`) wrongly label these "Planned"; the code shows they are implemented client-side. **Recommendation for the rebuild:** implement shadow/glow in the shared render path so they appear in server/high-res export too (resolves the gap and the doc drift). Confirm with the product owner (Master Brief §9).

## D.2 Colour systems

**Solid fill** (`fillColorMode: range | palette | define`):
- `range` → generate within an HSL range (with additional HSL controls).
- `palette` → pick from a defined palette.
- `define` → fixed colour.
- Opacity via `fillOpacityMode: range|define|incremental`.

**Gradient fill** — three gradient types selected by per-type probability (must sum to 100 when enabled):
- **Linear**: `fillGradientLinearDirection: fixed|range|predefined`; predefined ∈ `horizontal|vertical|diagonal-down|diagonal-up`.
- **Radial**: `fillGradientRadialCenter: center|corners|midpoints|coordinates`; center X/Y modes (`fixed|range|incremental`); `fillGradientRadialShape: circle|ellipse|auto`; selection mode `random|cycle`.
- **Conic**: `fillGradientConicCenter` (same options as radial); start-angle mode (`fixed|range|incremental`); center X/Y modes; selection mode.
- Shared gradient controls: `fillGradientColorMode: range|palette|define`, `fillGradientStopsMode: fixed|range`, `fillGradientStopDistribution: even|random`. Gradient generation helpers in `shared/gradientUtils.ts`.

**Stroke colour**: `strokeColorMode: range|palette|define` (+ HSL range controls), `strokeOpacityMode`, `strokeWidthMode`.

**Colour harmony — ✅ implemented** (`client/src/lib/colorManipulation.ts`; server `server/lib/colorUtils.ts` + `batchConfigProcessor.ts`):
- When `colorHarmonyEnabled`, harmony colours **override** fill/stroke/gradient colours during generation (step 3 of the pipeline, before normal fill/stroke).
- Harmony-specific settings select the scheme/relationship; HSL utilities live in `client/src/lib/hslColor.ts`.

## D.3 Echo / Motion Trails

A complete feature (`shared/echoUtils.ts`) that renders trailing "echoes" behind shapes. Shared logic guarantees client/server parity; safe defaults preserve backward compatibility.

```ts
interface EchoSpreadConfig {
  enabled: boolean;
  count: number;                                   // number of echoes
  scope: 'set' | 'shape' | 'both';                 // same echoes per set, per-shape, or combined
  driver: 'setRepIndex' | 'shapeIndex' | 'combined';
  directionMode: 'fixed-vector' | 'auto-motion' | 'absolute-position';

  fixedVector?: EchoFixedVectorConfig;             // angle + distance
  autoMotion?: EchoAutoMotionConfig;               // derive direction from set/shape motion
  absolutePosition?: EchoAbsolutePositionConfig;   // converge/diverge from a fixed point
  artboardTarget?: 'center'|'top-left'|'top-right'|'bottom-right'|'bottom-left'|'custom';

  // per-echo progressive effects (start/min/max + falloff)
  opacity?: EchoOpacityConfig;                     // opacity falloff per echo
  blur?: EchoBlurConfig;                           // blur progression
  scale?: EchoScaleConfig;                         // scale delta
  rotation?: EchoRotationConfig;                   // rotation with start/min/max clamp

  colorShift?: EchoColorShiftConfig;               // progressive HSL hue/sat/light per echo

  jitter?: EchoJitterConfig;                       // position jitter (angle/distance randomisation)
  perEffectJitter?: EchoPerEffectJitterConfig;     // per-effect jitter, mode 'fixed'|'range'

  applyTo?: EchoApplyToConfig;                      // which shapes get echoes
}

interface EchoApplyToConfig {
  shapeTypes?: SupportedShapeType[];               // filter by type
  selector: 'all' | 'even' | 'odd' | 'step';       // index selector
  step?: number;                                    // for 'step'
  probability?: number;                             // 0–100 chance per shape
}
```

Direction modes:
- **fixed-vector** — echoes offset along a fixed angle/distance.
- **auto-motion** — direction derived from the shape/set's own movement.
- **absolute-position** — echoes converge toward / diverge from a fixed coordinate (including artboard anchor points).

Per-set override: a `GenerationSet.echoOverride = { enabled, config }` lets an individual set replace the global echo settings, surfaced in `IndividualSetConfig.tsx`.

Defaults: `DEFAULT_ECHO_SPREAD_CONFIG`, `DEFAULT_ECHO_APPLY_TO_CONFIG`, `DEFAULT_ECHO_PER_EFFECT_JITTER` exist in `shared/schema.ts` and should be reproduced.

> Note on the `applyTo` field naming: it was intentionally designed to map cleanly onto a future "Shape Selection Groups" abstraction. That abstraction is **not** implemented (Appendix G) — keep `applyTo` as the concrete filter.
