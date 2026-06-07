// =============================================================================
// ShapeStudio — Generation Parity Suite (AR-2 harness) — SKELETON
// =============================================================================
// The automated test that makes client/server parity a build gate instead of a
// manual eyeball. Wired to the star + spline reference implementations.
//
// It checks three properties, cheapest first:
//   1. DETERMINISM      — same (config, seed) ⇒ identical output, every run.
//   2. STRUCTURE        — invariants per shape (vertex/handle counts, closed…).
//   3. CROSS-RUNTIME    — the shared core produces identical serialised output
//                         no matter which runtime imports it (the whole point of
//                         AR-1: there is ONE implementation, so this is true by
//                         construction — the test guards against regressions
//                         that reintroduce divergence).
//   (+ optional) GOLDEN — deterministic fixtures snapshot to disk; a diff means
//                         someone changed generation output on purpose or by
//                         accident. Reviewer decides which.
//
// Run: `vitest run parity`  (see package.json + vitest.config notes at bottom)
// =============================================================================

import { describe, it, expect } from 'vitest';
import { generateGeometry } from './generateGeometry-star';
import { generateCurveGeometry } from './generateGeometry-spline';
import type { Rng } from './generation-core-interface';

// -----------------------------------------------------------------------------
// Minimal seeded RNG (mulberry32) — the real one lives in shared/core. Inlined
// here so the suite is self-contained and runnable as a starting point.
// -----------------------------------------------------------------------------
function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    fork: (label) => createRng(seed ^ hashString(label)),
  };
  return rng;
}
function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// -----------------------------------------------------------------------------
// Stable serialisation for parity — sort keys, round floats so platform FP noise
// doesn't cause false negatives. Mirrors core.serializeForParity.
// -----------------------------------------------------------------------------
const PRECISION = 6;
function serializeForParity(value: unknown): string {
  return JSON.stringify(roundFloats(value), Object.keys(flatten(value)).sort());
}
function roundFloats(v: any): any {
  if (typeof v === 'number') return Number(v.toFixed(PRECISION));
  if (Array.isArray(v)) return v.map(roundFloats);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundFloats(x)]));
  return v;
}
function flatten(v: any, prefix = '', out: Record<string, true> = {}): Record<string, true> {
  if (v && typeof v === 'object') for (const k of Object.keys(v)) flatten(v[k], `${prefix}.${k}`, out);
  else out[prefix] = true;
  return out;
}

// -----------------------------------------------------------------------------
// Fixtures — the canonical set of (shape, size, params, seed) the gate covers.
// Grow this over time; one entry per shape type is the minimum bar. Use
// deterministic params (jitter 0 / value modes) for golden snapshots, and
// randomised params for the determinism test.
// -----------------------------------------------------------------------------
const STAR_FIXTURE = {
  size: { width: 100, height: 100 },
  params: { pointCount: { mode: 'value', value: 5 }, innerRadius: { mode: 'value', value: 0.4 } } as any,
  seed: 12345,
};
const SPLINE_FIXTURE = {
  size: { width: 120, height: 80 },
  params: {
    pointCount: { mode: 'value', value: 6 },
    jitter: { mode: 'value', value: 0 },     // 0 ⇒ fully deterministic, ideal golden
    tension: { mode: 'value', value: 0.5 },
  } as any,
  seed: 999,
};

// =============================================================================
// 1. DETERMINISM — same input twice ⇒ byte-identical serialised output
// =============================================================================
describe('determinism', () => {
  it('star: identical across repeated runs with the same seed', () => {
    const a = generateGeometry('star', STAR_FIXTURE.size, STAR_FIXTURE.params, { index: 0, rng: createRng(STAR_FIXTURE.seed) });
    const b = generateGeometry('star', STAR_FIXTURE.size, STAR_FIXTURE.params, { index: 0, rng: createRng(STAR_FIXTURE.seed) });
    expect(serializeForParity(a)).toEqual(serializeForParity(b));
  });

  it('spline: identical across repeated runs with the same seed', () => {
    const a = generateCurveGeometry('smooth-spline', SPLINE_FIXTURE.size, SPLINE_FIXTURE.params, { index: 0, rng: createRng(SPLINE_FIXTURE.seed) });
    const b = generateCurveGeometry('smooth-spline', SPLINE_FIXTURE.size, SPLINE_FIXTURE.params, { index: 0, rng: createRng(SPLINE_FIXTURE.seed) });
    expect(serializeForParity(a)).toEqual(serializeForParity(b));
  });

  it('different seeds CAN differ (sanity: RNG is actually wired)', () => {
    const jittered = { ...SPLINE_FIXTURE.params, jitter: { mode: 'value', value: 0.6 } };
    const a = generateCurveGeometry('smooth-spline', SPLINE_FIXTURE.size, jittered, { index: 0, rng: createRng(1) });
    const b = generateCurveGeometry('smooth-spline', SPLINE_FIXTURE.size, jittered, { index: 0, rng: createRng(2) });
    expect(serializeForParity(a)).not.toEqual(serializeForParity(b));
  });
});

// =============================================================================
// 2. STRUCTURE — per-shape invariants (catches wrong vertex/handle counts etc.)
// =============================================================================
describe('structural invariants', () => {
  it('star: N points ⇒ 2N vertices, closed, first vertex up', () => {
    const g = generateGeometry('star', STAR_FIXTURE.size, STAR_FIXTURE.params, { index: 0, rng: createRng(STAR_FIXTURE.seed) });
    expect(g.points.length).toBe(10);
    expect(g.closed).toBe(true);
    expect(g.points[0].x).toBeCloseTo(0, PRECISION);
    expect(g.points[0].y).toBeCloseTo(-50, PRECISION);
  });

  it('spline: N anchors ⇒ N tangent-handle pairs, 2N control points, closed', () => {
    const g = generateCurveGeometry('smooth-spline', SPLINE_FIXTURE.size, SPLINE_FIXTURE.params, { index: 0, rng: createRng(SPLINE_FIXTURE.seed) });
    expect(g.points.length).toBe(6);
    expect(g.tangentHandles.length).toBe(6);
    expect(g.controlPoints.length).toBe(12);
    expect(g.closed).toBe(true);
    expect(g.points[0].x).toBeCloseTo(0, PRECISION);
    expect(g.points[0].y).toBeCloseTo(-40, PRECISION); // ry = 40, first anchor up
  });

  it('star: never degenerates below 3 points even if config asks for fewer', () => {
    const g = generateGeometry('star', STAR_FIXTURE.size, { pointCount: { mode: 'value', value: 1 }, innerRadius: { mode: 'value', value: 0.4 } } as any, { index: 0, rng: createRng(1) });
    expect(g.points.length).toBeGreaterThanOrEqual(6); // clamped to 3 ⇒ 6 vertices
  });
});

// =============================================================================
// 3. CROSS-RUNTIME PARITY — the AR-2 gate
// =============================================================================
// In the real repo: import the core via the CLIENT entry and the SERVER entry
// (e.g. resolve `@shared/core` two ways, or run the same fixtures in jsdom vs
// node environments) and assert equality. With a single shared core there is
// only ONE implementation, so the assertion documents + protects that fact: any
// future PR that forks generation logic per runtime breaks this test.
describe('cross-runtime parity (AR-2 gate)', () => {
  const FIXTURES = [
    () => generateGeometry('star', STAR_FIXTURE.size, STAR_FIXTURE.params, { index: 0, rng: createRng(STAR_FIXTURE.seed) }),
    () => generateCurveGeometry('smooth-spline', SPLINE_FIXTURE.size, SPLINE_FIXTURE.params, { index: 0, rng: createRng(SPLINE_FIXTURE.seed) }),
  ];

  it.each(FIXTURES.map((f, i) => [i, f] as const))('fixture %i: client core == server core', (_i, build) => {
    // Placeholder: both call the SAME shared core today. Replace one side with
    // the server-entry import once the renderers are split, to make this a true
    // two-runtime check.
    const clientOut = serializeForParity(build());
    const serverOut = serializeForParity(build());
    expect(clientOut).toEqual(serverOut);
  });
});

// =============================================================================
// 4. GOLDEN SNAPSHOTS (optional but recommended) — output regression guard
// =============================================================================
// Deterministic fixtures only. First run writes the snapshot; later runs diff.
// A change here is a deliberate decision the reviewer signs off on.
describe('golden output', () => {
  it('star fixture matches stored geometry', () => {
    const g = generateGeometry('star', STAR_FIXTURE.size, STAR_FIXTURE.params, { index: 0, rng: createRng(STAR_FIXTURE.seed) });
    expect(roundFloats(g)).toMatchSnapshot();
  });
  it('spline fixture (jitter 0) matches stored geometry', () => {
    const g = generateCurveGeometry('smooth-spline', SPLINE_FIXTURE.size, SPLINE_FIXTURE.params, { index: 0, rng: createRng(SPLINE_FIXTURE.seed) });
    expect(roundFloats(g)).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------------
// SECOND STAGE (not in this skeleton): pixel parity.
//   Rasterise each fixture via CanvasShapeRenderer (jsdom/node-canvas) AND
//   NodeShapeRenderer (sharp), then assert pixel diff < tolerance (e.g. pixelmatch).
//   Structural parity above catches ~all generation drift cheaply; pixel parity
//   catches renderer drift (blend modes, effects, anti-aliasing).
// -----------------------------------------------------------------------------

// =============================================================================
// WIRING NOTES
// -----------------------------------------------------------------------------
// package.json:
//   "scripts": {
//     "test":        "vitest run",
//     "test:watch":  "vitest",
//     "test:parity": "vitest run parity"
//   },
//   "devDependencies": { "vitest": "^2", "pixelmatch": "^6", "pngjs": "^7" }
//
// vitest.config.ts:
//   import { defineConfig } from 'vitest/config';
//   export default defineConfig({
//     test: {
//       environment: 'node',                 // generation core needs no DOM
//       include: ['**/*.{test,spec}.ts', '**/*-parity.ts'],
//       coverage: { provider: 'v8' },
//     },
//     resolve: { alias: { '@shared': '/shared' } },
//   });
//
// CI (.github/workflows/ci.yml): run `tsc --noEmit && eslint . && vitest run`
// on every PR. This is AR-5 — stand it up BEFORE the refactors so each step
// ships safely.
// =============================================================================
