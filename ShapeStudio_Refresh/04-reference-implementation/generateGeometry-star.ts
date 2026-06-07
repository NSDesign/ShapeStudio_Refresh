// =============================================================================
// ShapeStudio — generateGeometry: worked reference (STAR)
// =============================================================================
// A concrete, runnable implementation of ONE shape type through the core
// boundary from the Generation Core Interface. Star is chosen because it
// exercises the non-trivial bits: an inner-radius parameter, a segment/point
// count, and `ModeValue` resolution — so it generalises to polygon, ring, and
// the spline-* family.
//
// This is real geometry math (not a stub): given a size + params, it returns
// local-space points. NO canvas, NO DOM — pure. The renderer turns these points
// into a path. The SAME function runs on client and server (AR-1), which is why
// `serializeForParity(generateGeometry(...))` is identical across runtimes (AR-2).
// =============================================================================

import type { Point, SupportedShapeType, ModeValue, Rng } from './generation-core-interface';

// Local helper — the core's resolveMode, shown inline for a self-contained ref.
function resolveMode(m: ModeValue<number>, ctx: { index: number; rng: Rng }): number {
  switch (m.mode) {
    case 'value':       return m.value;
    case 'range':       return m.range[0] + ctx.rng.next() * (m.range[1] - m.range[0]);
    case 'incremental': return m.start + m.increment * ctx.index;
  }
}

// Params relevant to the star (subset of ShapeParamsConfig).
interface StarParams {
  pointCount: ModeValue<number>;    // number of star points (e.g. 5) — min 3
  innerRadius: ModeValue<number>;   // ratio 0..1 of outer radius (matches legacy 0.3–0.7)
}

interface Geometry { points: Point[]; closed: boolean; controlPoints?: Point[]; }

// -----------------------------------------------------------------------------
// STAR
// -----------------------------------------------------------------------------
// Outer radius derives from size; a star alternates outer/inner vertices around
// the centre. Even N points ⇒ 2N vertices. First vertex points "up" (-90°) to
// match the app's convention. Output is centred on (0,0) in local space; the
// shape's Transform (from the core) positions it in world/artboard space.
function generateStar(
  size: { width: number; height: number },
  params: StarParams,
  ctx: { index: number; rng: Rng },
): Geometry {
  // Resolve parameterised knobs once, deterministically.
  const rawPoints = Math.round(resolveMode(params.pointCount, ctx));
  const numPoints = Math.max(3, rawPoints);                 // guard: a star needs ≥3
  const innerRatio = clamp(resolveMode(params.innerRadius, ctx), 0.05, 0.95);

  // Outer radius from bounding size; allow non-uniform W/H by scaling per-axis.
  const rxOuter = size.width / 2;
  const ryOuter = size.height / 2;
  const rxInner = rxOuter * innerRatio;
  const ryInner = ryOuter * innerRatio;

  const points: Point[] = [];
  const start = -Math.PI / 2;                                // first point up
  const step = Math.PI / numPoints;                          // half-step: alternate out/in

  for (let i = 0; i < numPoints * 2; i++) {
    const isOuter = i % 2 === 0;
    const angle = start + step * i;
    const rx = isOuter ? rxOuter : rxInner;
    const ry = isOuter ? ryOuter : ryInner;
    points.push({ x: Math.cos(angle) * rx, y: Math.sin(angle) * ry });
  }

  return { points, closed: true };
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

// -----------------------------------------------------------------------------
// Dispatch — how generateGeometry routes by type
// -----------------------------------------------------------------------------
// The real core has a case per SupportedShapeType; this shows star wired in and
// the pattern the others follow (polygon ≈ star with one radius; ring ≈ two
// circles; rectangle ≈ 4 corners; etc.).
export function generateGeometry(
  type: SupportedShapeType,
  size: { width: number; height: number },
  params: StarParams /* = the resolved ShapeParamsConfig for this type */,
  ctx: { index: number; rng: Rng },
): Geometry {
  switch (type) {
    case 'star':
      return generateStar(size, params, ctx);

    // case 'polygon':  return generatePolygon(size, { sides: params.pointCount }, ctx);   // single radius, N vertices
    // case 'ring':     return generateRing(size, { innerRatio: params.innerRadius }, ctx); // outer + inner ring (closed:true, even-odd fill)
    // case 'rectangle':return { points: rectCorners(size), closed: true };
    // case 'circle':   return generateEllipse(size, /* segments */ 64, ctx);
    // …one case per shape type, each pure…

    default:
      throw new Error(`generateGeometry: unhandled shape type "${type}"`);
  }
}

// -----------------------------------------------------------------------------
// Worked example (what a test asserts)
// -----------------------------------------------------------------------------
// const rng = createRng(12345);
// const geo = generateGeometry('star', { width: 100, height: 100 },
//   { pointCount: { mode: 'value', value: 5 }, innerRadius: { mode: 'value', value: 0.4 } },
//   { index: 0, rng });
// geo.points.length === 10          // 5 points ⇒ 10 vertices
// geo.points[0]  ≈ { x: 0, y: -50 } // first vertex points up at outer radius
// geo.closed === true
//
// Because this is pure + seeded, the same call on the Node server yields the
// identical array — which is the entire point of AR-1/AR-2.
