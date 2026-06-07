# Appendix C — Distribution, Grid & Masking

How shapes are placed and which positions render. Two related layers exist: **Distribution Layout** (where the BatchConfig places shapes) and **scatter placement** (count + spread). Plus the grid offset system, shape masking, and cell-based rendering. All implemented and verified.

---

## C.1 Distribution layouts

`distributionLayouts.ts` (server) + client equivalent define the layout pattern applied during generation:

```
pattern: 'grid' | 'wave' | 'ellipse' | 'spiral' | 'auto-distribute'
```

- **Grid** — rows × cols placement; spacing controlled by `gridSpacingXMode`/`gridSpacingYMode`: `define | auto-centered | auto-edge-to-edge`. Supports randomization (additive pixel offsets), offsets (C.3), masking (C.4), and cell constraints (C.5).
- **Wave** — shapes follow a wave path (amplitude/frequency parameters).
- **Ellipse / Ring** — concentric rings; `ellipseRingSpacing: even|progressive`, `ellipseRotationAlignment: uniform|progressive`, `ellipseShapeRotationMode: none|fixed|range|incremental`.
- **Spiral** — `spiralSpacingMode: linear|logarithmic`.
- **Auto-distribute** — automatic placement to fill the area.

Shared pattern enhancements: `segmentDistribution: even|clustered` controls how shapes spread along a path.

## C.2 Scatter placement

`ScatterSettings` (in `useShapeEditor`) governs how many shapes and how they spread when scattering onto points or inside an area:
- `onPoints` / `insideArea` targets.
- `shapeCountMode: fixed` (with `fixedShapeCount`) or range (`minCount`/`maxCount`).
- `distribution`: `{ pattern, spacing, randomness, rotation, scale, density, avoidOverlap, respectBounds }` — the placement algorithm (`distributionAlgorithm.ts`) supports several internal patterns (grid, circle, spiral, organic, wave, cluster).
- Per-shape-type scatter ranges (`shapeSpecific`), e.g. polygon edge-count range, circle/ellipse segment-count range, bezier point-count + open probability + stroke-cap probabilities, cubic point-count + curvature/spread/pattern, smooth-spline point-count, etc.

## C.3 Grid offset system

`GridOffsetsConfig` (shared, `gridOffsetUtils.ts`) shifts rows/columns to break up rigid grids. Implemented across phases (all verified ✅):
- **Alternating offsets** — offset every Nth row/column by an amount/direction.
- **Pattern offsets** — explicit per-row/column offset patterns.
- **Presets** — saved offset configurations.
- **Value modes** — different ways of expressing the offset amount.

```ts
interface GridOffsetAxisConfig { enabled: boolean; pattern: number[]; amount: number; direction: 'up'|'down'|'left'|'right'; /* + mode fields */ }
interface GridOffsetsConfig { row: GridOffsetAxisConfig; column: GridOffsetAxisConfig; /* + preset/value-mode fields */ }
```
Row offset is applied to matched rows; column offset to matched columns (both can combine).

## C.4 Shape Masking (grid-position filter)

`ShapeMaskingConfig` is a **standalone top-level section** (sibling of Distribution Layout, not nested), controlling which grid positions render.

```ts
interface ShapeMaskingConfig {
  enabled: boolean;                      // master toggle
  grid: {
    enabled: boolean;
    mode: 'alternating' | 'pattern';
    invert: boolean;                     // false = exclude matched; true = render only matched
    priority: 'row-first' | 'column-first';
    alternating: { skipEvery: number; startIndex: number };
    pattern: Array<{ row: number; columns: number[] }>;
  };
  // architecture leaves room for future filter types (position/count/color/size/rotation/opacity)
  // — NOT implemented; do not build in a rebuild unless requested.
}
```
Grid masking only applies when Distribution Layout pattern is `grid` (no row/column concept otherwise). Dual enable toggles: master + per-filter.

## C.5 Cell-based rendering (Cell Points / cell constraints)

`CellConstraintsConfig` enables placing shapes relative to grid **cells** rather than only intersection points, with size constraints so shapes fit their allocated cell. Render modes:
- **Point** — shapes at intersections, original size.
- **Cell** — shapes in cells between grid lines, with size constraints.
- **Cell Points** — shapes at intersections with cell-based size constraints.

Implemented (Nov 2025) and verified.

## C.6 Sorting

After placement, shapes can be sorted (affects layering/order and some layouts). Sort keys observed in `distributionLayouts.ts` include:
`layer, creation-time, shape-type, size, fill-color, opacity, angle, id, corner-radius, point-count, edge-count, inner-radius, segment-count, direction, length, centroid, spread, curvature`.
Sort scope: `gridSortScope: per-generation | per-batch`; direction: `gridSortOrder: ascending | descending`.

## C.7 Client/server parity

Grid offsets, masking, and distribution all run identically in browser and server export. Shared helpers (`shared/gridOffsetUtils.ts`, `shared/batchUtils.ts`, `shared/incrementalUtils.ts`) plus server processors (`server/lib/distributionLayouts.ts`, `distributionAlgorithm.ts`, `positionModulationResolver.ts`, `batchConfigProcessor.ts`) must mirror the client. Keep the parity test (`shared/exportParityTest.ts`) covering these.
