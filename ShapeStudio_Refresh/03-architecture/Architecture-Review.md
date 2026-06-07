# ShapeStudio — Architecture Review

A code-grounded review of the current architecture, with prioritized, actionable recommendations. Every claim below was verified against the cloned codebase (`github.com/NSDesign/ShapeStudio`). This document is intended to sit alongside the redevelopment brief and, where a rebuild is chosen, to become its "Architecture Requirements."

---

## 1. Evidence base (measured, not estimated)

| Metric | Value | Source |
|---|---|---|
| Largest client file | `BatchConfigDialog.tsx` — **11,433 lines** | `wc -l` |
| Control surface | `Sidebar.tsx` — **9,312 lines** | `wc -l` |
| Central state hook | `useShapeEditor.ts` — **5,584 lines**, 34 `useState`, 100 hooks total | `wc -l`, grep |
| Config god-object | `BatchConfigSettings` ≈ **533 fields** | grep over `shared/schema.ts` |
| Schema file | `shared/schema.ts` — **4,137 lines** | `wc -l` |
| Export service | `exportService.ts` — **4,782 lines** (1 file: batch + high-res + tiling + SSE) | `wc -l` |
| Server generation dup | `shapeGenerator.ts` 1,973 + `batchConfigProcessor.ts` 1,705 | `wc -l` |
| Prop-drilling | `<Sidebar>` receives **69 props**, `<Canvas>` **35** | grep over `ShapeEditor.tsx` |
| State management | **No Context/store** for editor state | grep (`createContext`/store = none for editor) |
| Backwards dependency | `server/lib/shapeGenerator.ts` imports `client/src/lib/shapeTypes` | file line 1 |
| Tests / lint | **None.** Only `check: tsc`. No Vitest/Jest/ESLint/Prettier/CI | `package.json` |
| TypeScript | `strict: true` ✅ | `tsconfig.json` |
| Parity guard | `shared/exportParityTest.ts` — checks export-setting **defaults only**, not generation output | file |

---

## 2. What is healthy (keep)

- **Monorepo + `shared/` boundary is correct.** Client / server / shared with `@/` and `@shared/` aliases is the right structure. The issue is that `shared/` is under-used, not wrong.
- **`strict: true`** is enabled across all three roots.
- **Parity intent exists** (`exportParityTest.ts`). The instinct is right; only the coverage is too narrow.
- **Declarative, seeded, reproducible generation** — configuration-as-recipe is a genuine strength and should survive any refactor.
- **Drizzle + Zod + a thin `storage` layer** — routes go through `storage`, not raw SQL. Good separation.

---

## 3. Structural problems (ranked by leverage)

### Problem 1 — Generation logic is duplicated instead of shared (TOP PRIORITY)

**Finding.** The shape-generation and property-application math exists twice:
- Client: `client/src/lib/shapes.ts` (3,993) + `shapeTypes.ts` (1,625).
- Server: `server/lib/shapeGenerator.ts` (1,973) + `batchConfigProcessor.ts` (1,705).

`shared/` contains only small helpers (`echoUtils`, `gridOffsetUtils`, `gradientUtils`, `incrementalUtils`, `batchUtils`) — **not** the heavy geometry/property logic. Worse, the server reaches *into the client* for types: `server/lib/shapeGenerator.ts:1` imports from `../../client/src/lib/shapeTypes` — a server→client dependency that inverts the intended layering. The server then re-derives geometry independently (e.g. its own star inner-radius math at `shapeGenerator.ts:532`).

**Consequence.** Every generation feature must be written twice and can silently diverge. This is the direct cause of the verified shadow/glow gap (client renders it, server export doesn't). The parity test only compares export-setting *defaults*, so output drift is invisible until a human spots a wrong pixel.

**Recommendation.**
1. Extract a **framework-agnostic generation core into `shared/`**: pure functions `(config, seed, index) → { geometry, properties }` with zero DOM/canvas dependency.
2. Client and server both import this core. Each owns only its **renderer** (browser `CanvasRenderingContext2D` vs node-canvas/Sharp). Renderers become thin.
3. Invert the bad dependency: shape *types* live in `shared/`, consumed by both — never server→client.
4. Replace the defaults-only parity test with a **golden-output parity suite**: serialize generated shapes for a fixed set of seeded configs and assert `client-core(config) === server-core(config)`.

**Payoff.** Eliminates ~3,500 lines of server duplication, makes parity structural (not aspirational), and closes the class of bug that produced the shadow/glow gap.

---

### Problem 2 — `BatchConfigSettings` is a 533-field flat god-object

**Finding.** One flat interface (~700 lines of fields + ~700 lines of `defaultBatchConfigSettings`) holds every feature's parameters: grid/wave/ellipse/spiral, sizing, position + modulation, every shape-type's params, fill (solid + linear/radial/conic gradients), stroke, blur, 4 shadow/glow effects, transforms, echo, colour harmony, physics, and disabled temporal fields. The `*Mode: range|value|incremental` pattern is hand-repeated hundreds of times.

**Consequence.** Unrelated features share one namespace; defaults are an unmanageable literal; migrations are fragile and all-or-nothing; the UI mirrors the object's flatness (see Problem 4).

**Recommendation.**
1. Decompose into **composed sub-configs**: `{ distribution, sizing, position, fill, stroke, effects, transform, echo, harmony }`, each with its own interface, defaults, and Zod schema, assembled into the parent. Keep serialized keys stable (or provide a migration) so existing project files still load.
2. Model the repeated mode pattern **once** as a generic discriminated union, e.g. `type ModeValue<T> = { mode:'value'; value:T } | { mode:'range'; range:[T,T] } | { mode:'incremental'; start:T; increment:T }`, and reuse everywhere.

**Payoff.** Per-section reasoning, testing, migration, and lazy-loaded UI; removes hundreds of lines of repetition.

---

### Problem 3 — State is one 5,584-line hook prop-drilled through 69 props

**Finding.** `useShapeEditor` owns 34 `useState` + 100 hooks and returns a single huge object. `ShapeEditor` passes **69 props to `Sidebar`** and **35 to `Canvas`**. There is **no Context or store** for editor state.

**Consequence.** Any state change can re-render the whole editor; the hook is effectively untestable and cannot be split; prop-drilling makes every new field a multi-file edit.

**Recommendation.** Adopt a selector-based store (**Zustand** fits this app well) — components subscribe to slices, which kills both the re-render storm and the prop-drilling. Minimum viable alternative: split into domain hooks behind a Context (`useShapes`, `useSelection`, `useGenerationSets`, `useArtboard`). This is the prerequisite that makes Problem 4 tractable.

---

### Problem 4 — UI files are unmaintainable by size

**Finding.** `BatchConfigDialog.tsx` is **11,433 lines** (largest file in the repo), `Sidebar.tsx` 9,312, `IndividualSetConfig.tsx` 2,363. They mirror the flat config object. A documented footgun lives here too: every `<SelectContent>` in a dialog must carry `style={{ zIndex: 10002 }}` or it renders behind the overlay (noted in `replit.md`).

**Recommendation.** After Problems 2–3, split these into **per-section panels** (`<FillPanel>`, `<DistributionPanel>`, `<EffectsPanel>`…), each bound to its sub-config and store slice. Encapsulate the z-index gotcha in one shared `<DialogSelect>` wrapper so it can never be forgotten again.

---

### Problem 5 — No automated tests, lint, or CI

**Finding.** `package.json` scripts: only `dev`, `build`, `start`, `check (tsc)`, `db:push`. No Vitest/Jest, no ESLint/Prettier, no `.github` CI workflow gate. There are ad-hoc `server/validation/*-test.ts` scripts and an in-app `GenerationSetsTestRunner`, but nothing automated.

**Consequence.** For an app whose core correctness property is "the same config produces the same image on both runtimes," there is no automated check of that property. This is the highest-risk gap after the duplication itself.

**Recommendation.** Add **Vitest** + the golden-output parity suite from Problem 1, **ESLint + Prettier**, and a CI workflow that runs `tsc` + lint + tests on PR. Do this **first**, so the refactors below are safe.

---

## 4. Recommended sequence

1. **Safety net:** add tests + lint + CI (and the parity-output harness).
2. **Shared generation core:** extract pure generation into `shared/`; delete server duplication; fix the server→client type dependency.
3. **State store:** introduce Zustand (or Context + domain hooks); remove prop-drilling.
4. **Config decomposition:** split `BatchConfigSettings` into composed sub-configs + `ModeValue<T>`.
5. **UI decomposition:** split the giant dialogs/sidebar along the new sub-config boundaries.

Steps 2–4 are mutually reinforcing and carry the most value. **None requires changing the technology stack.**

---

## 5. Refactor-in-place vs rebuild

- **Refactor in place** is viable and lower-risk: the steps above are independently shippable behind the existing behaviour, and `strict` TypeScript + the existing `shared/` boundary give you a foothold. The blocker is the absence of tests — close that first (step 1) and the rest becomes safe.
- **If a rebuild is chosen,** these stop being refactors and become **brief requirements**:
  - Generation core in `shared/`; renderers are thin and runtime-specific.
  - Config = composed sub-objects built on a single `ModeValue<T>` primitive.
  - Selector-based state store from day one.
  - Parity enforced by a CI golden-output test, not a defaults check.
  - Same stack; drop Replit coupling and the deprecated Live API (per the redevelopment brief).

**Suggested action:** add an "Architecture Requirements" section to the Master Brief capturing the four bullets above, so the latent risks in the current codebase become explicit design constraints in the rebuild.
