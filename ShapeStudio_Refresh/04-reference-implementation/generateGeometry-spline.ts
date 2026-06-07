// =============================================================================
// ShapeStudio — generateGeometry: worked reference (SMOOTH-SPLINE)
// =============================================================================
// A second concrete implementation through the core boundary — chosen because
// it is STRUCTURALLY DIFFERENT from star/polygon: a curve carries control data
// (per-anchor tangent handles) and can be open or closed. If the boundary holds
// for this, it holds for bezier/cubic/spline-circle/ellipse/ring too.
//
// Faithful to the real model (client/src/lib/shapeTypes.ts):
//   points:         Point[]                 // anchors
//   tangentHandles: { in, out, linked, smooth }[]   // one per anchor
//   controlPoints:  Point[]                 // flattened handles (renderer convenience)
//   closed:         boolean
//
// Tangents are derived Catmull-Rom → cubic-Bézier style (each anchor's handles
// come from its neighbours), which is how the app produces smooth continuity.
// Pure: no DOM, no canvas, all randomness via the seeded Rng (AR-1 / AR-2).
//
// ⚠ Interface note: this requires ONE addition to `GeneratedShape` in
// generation-core-interface.ts — an optional `tangentHandles?: TangentHandle[]`.
// Added here as a local type; fold it into the core interface.
// =============================================================================

import type { Point, SupportedShapeType, ModeValue, Rng } from './generation-core-interface';

// --- interface extension to fold into the core --------------------------------
export interface TangentHandle {
  in: Point;       // incoming handle (controls curve arriving at the anchor)
  out: Point;      // outgoing handle (controls curve leaving the anchor)
  linked: boolean; // handles maintain collinearity (smooth) vs independent
  smooth: boolean; // anchor is a smooth (C1) join vs a sharp corner
}
interface CurveGeometry {
  points: Point[];
  closed: boolean;
  controlPoints: Point[];        // [in0, out0, in1, out1, …] flattened, render-ready
  tangentHandles: TangentHandle[];
}
// -----------------------------------------------------------------------------

function resolveMode(m: ModeValue<number>, ctx: { index: number; rng: Rng }): number {
  switch (m.mode) {
    case 'value':       return m.value;
    case 'range':       return m.range[0] + ctx.rng.next() * (m.range[1] - m.range[0]);
    case 'incremental': return m.start + m.increment * ctx.index;
  }
}

interface SplineParams {
  pointCount: ModeValue<number>;   // anchors (real default 4–8; min 3 for a closed loop)
  jitter: ModeValue<number>;       // 0..1 radial wobble applied to the base ellipse
  tension: ModeValue<number>;      // 0..1; scales handle length (0.5 ≈ uniform Catmull-Rom)
}

// vector helpers (pure)
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });

// -----------------------------------------------------------------------------
// SMOOTH-SPLINE
// -----------------------------------------------------------------------------
function generateSmoothSpline(
  size: { width: number; height: number },
  params: SplineParams,
  ctx: { index: number; rng: Rng },
  closed = true,
): CurveGeometry {
  const n = Math.max(3, Math.round(resolveMode(params.pointCount, ctx)));
  const jitter = clamp(resolveMode(params.jitter, ctx), 0, 1);
  const tension = clamp(resolveMode(params.tension, ctx), 0, 1);

  const rx = size.width / 2;
  const ry = size.height / 2;

  // 1) Anchors: evenly around an ellipse, with seeded radial jitter for organic
  //    variety. A dedicated child RNG keeps anchor jitter independent of any
  //    later property randomness (so changing fill never moves the geometry).
  const geomRng = ctx.rng.fork('spline-anchors');
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 - Math.PI / 2;     // first anchor up
    const wobble = 1 + (geomRng.next() * 2 - 1) * jitter * 0.5;
    points.push({ x: Math.cos(t) * rx * wobble, y: Math.sin(t) * ry * wobble });
  }

  // 2) Tangent handles via Catmull-Rom → cubic Bézier:
  //    handleVector_i = (P_{i+1} - P_{i-1}) * (tension / 3)
  //    out_i = P_i + handleVector_i ;  in_i = P_i - handleVector_i
  //    For open curves the endpoints clamp to their single neighbour.
  const tangentHandles: TangentHandle[] = [];
  const controlPoints: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const isEndpoint = !closed && (i === 0 || i === n - 1);

    const dir = isEndpoint
      ? (i === 0 ? sub(points[1], points[0]) : sub(points[n - 1], points[n - 2]))
      : sub(next, prev);

    const handle = scale(dir, tension / 3);
    const outH = add(points[i], handle);
    const inH = sub(points[i], handle);

    tangentHandles.push({ in: inH, out: outH, linked: true, smooth: true });
    controlPoints.push(inH, outH);
  }

  return { points, closed, controlPoints, tangentHandles };
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

// -----------------------------------------------------------------------------
// Dispatch (curve family shares this path)
// -----------------------------------------------------------------------------
export function generateCurveGeometry(
  type: SupportedShapeType,
  size: { width: number; height: number },
  params: SplineParams,
  ctx: { index: number; rng: Rng },
): CurveGeometry {
  switch (type) {
    case 'smooth-spline': return generateSmoothSpline(size, params, ctx, true);
    case 'bezier':        return generateSmoothSpline(size, params, ctx, false); // open variant
    // case 'cubic':         curvature/spread variant — same handle model, different anchor placement
    // case 'spline-circle': anchors on a circle, tension fixed → smooth ring
    default:
      throw new Error(`generateCurveGeometry: unhandled curve type "${type}"`);
  }
}

// -----------------------------------------------------------------------------
// Worked example (what the parity test asserts)
// -----------------------------------------------------------------------------
// const rng = createRng(999);
// const geo = generateCurveGeometry('smooth-spline', { width: 120, height: 80 },
//   { pointCount: { mode: 'value', value: 6 },
//     jitter:     { mode: 'value', value: 0 },     // 0 ⇒ perfect ellipse, deterministic
//     tension:    { mode: 'value', value: 0.5 } },
//   { index: 0, rng });
// geo.points.length === 6
// geo.tangentHandles.length === 6           // one handle pair per anchor
// geo.controlPoints.length === 12           // flattened in/out
// geo.closed === true
// geo.points[0] ≈ { x: 0, y: -40 }          // first anchor up, on the ellipse
// With jitter 0 the whole result is fully deterministic regardless of seed,
// which makes it an ideal golden-snapshot fixture.
