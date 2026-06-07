# ShapeStudio_Refresh

A complete documentation + reference-implementation set for rebuilding (or refactoring) ShapeStudio. Everything here was reverse-engineered from the actual codebase (`github.com/NSDesign/ShapeStudio`), with **code treated as authoritative** over the in-repo docs.

## How to read this, in order

1. **`01-brief/00-Master-Brief.md`** — start here. The redevelopment brief: product summary, stack, architecture, the §4 **Architecture Requirements (AR-1…AR-6)**, the implemented feature inventory (the build target), build sequence, and open decisions.
2. **`02-appendices/`** — per-feature detail and schemas referenced by the brief:
   - `A` Shape System & Canvas
   - `B` Generation System & Configuration Schema
   - `C` Distribution, Grid & Masking
   - `D` Effects, Colour & Echo / Motion Trails
   - `E` Export System (client + server high-res) & Print
   - `F` Persistence, Auth & Data Model
   - `G` **Post-Implementation Notes** — deprecated / incomplete / planned / removed (the Live API, hardcoded credentials, physics, doc-vs-code corrections). Read this to know the boundaries.
3. **`03-architecture/Architecture-Review.md`** — the measured evidence base behind the Architecture Requirements: the five structural problems (generation duplication, the 533-field god-object, the 5,584-line prop-drilled hook, the 11k-line UI files, no tests/CI), ranked, with a refactor-vs-rebuild sequencing plan.
4. **`04-reference-implementation/`** — concrete TypeScript drafts that turn AR-1/AR-3 into code:
   - `generation-core-interface.ts` — the runtime-agnostic `(config, seed, index) → GeneratedShape[]` boundary; `ModeValue<T>`; the `ShapeRenderer` split; the parity harness.
   - `generateGeometry-star.ts` — a real, pure geometry implementation (vertex-list shape), as the pattern for polygon/ring/rectangle.
   - `generateGeometry-spline.ts` — a structurally different worked example: a curve with per-anchor tangent handles / control points (Catmull-Rom → Bézier), open or closed. Pattern for bezier/cubic/spline-*. Notes the one `tangentHandles` field to add to the core interface.
   - `config-migration.ts` — the flat `BatchConfigSettings` → composed sub-configs migration (`collapseMode`/`expandMode`, versioned `loadConfig`, full cluster→home checklist).
   - `generation-parity.test.ts` — the **AR-2 harness** (Vitest): determinism, structural invariants, the cross-runtime parity gate, and golden snapshots, wired to the star + spline references. Includes package.json / vitest.config / CI wiring notes. Stand this up first (AR-5).

## Status of the `.ts` files
They are **contracts/references**, not buildable modules — function bodies in the interface and migration files are intentionally stubbed so they read as specifications. `generateGeometry-star.ts` contains real math. Names are rename-friendly; preserve semantics, not identifiers.

## The one-line summary
Build the implemented feature set (Appendices A–F). Drop the Live State API + hardcoded credentials, the Replit coupling, and debug/backup files (Appendix G). Implement generation once in `shared/` behind the core interface, enforce client/server parity with a CI golden-output test, decompose the config onto `ModeValue<T>`, and put state in a selector store (Architecture Requirements §4).
