# ShapeStudio_Refresh

A complete documentation + reference-implementation set for rebuilding (or refactoring) ShapeStudio. Everything here was reverse-engineered from the actual codebase (`github.com/NSDesign/ShapeStudi[...]

## How to read this, in order

1. **`01-brief/00-Master-Brief.md`** — start here. The redevelopment brief: product summary, stack, architecture, the §4 **Architecture Requirements (AR-1…AR-6)**, the implemented feature inve[...]
2. **`02-appendices/`** — per-feature detail and schemas referenced by the brief:
   - `A` Shape System & Canvas
   - `B` Generation System & Configuration Schema
   - `C` Distribution, Grid & Masking
   - `D` Effects, Colour & Echo / Motion Trails
   - `E` Export System (client + server high-res) & Print
   - `F` Persistence, Auth & Data Model
   - `G` **Post-Implementation Notes** — deprecated / incomplete / planned / removed (the Live API, hardcoded credentials, physics, doc-vs-code corrections). Read this to know the boundaries.
3. **`03-architecture/Architecture-Review.md`** — the measured evidence base behind the Architecture Requirements: the five structural problems (generation duplication, the 533-field god-object,[...]
4. **`04-reference-implementation/`** — concrete TypeScript drafts that turn AR-1/AR-3 into code:
   - `generation-core-interface.ts` — the runtime-agnostic `(config, seed, index) → GeneratedShape[]` boundary; `ModeValue<T>`; the `ShapeRenderer` split; the parity harness.
   - `generateGeometry-star.ts` — a real, pure geometry implementation (vertex-list shape), as the pattern for polygon/ring/rectangle.
   - `generateGeometry-spline.ts` — a structurally different worked example: a curve with per-anchor tangent handles / control points (Catmull-Rom → Bézier), open or closed. Pattern for bezie[...]
   - `config-migration.ts` — the flat `BatchConfigSettings` → composed sub-configs migration (`collapseMode`/`expandMode`, versioned `loadConfig`, full cluster→home checklist).
   - `generation-parity.test.ts` — the **AR-2 harness** (Vitest): determinism, structural invariants, the cross-runtime parity gate, and golden snapshots, wired to the star + spline references. [...]

## Status of the `.ts` files
They are **contracts/references**, not buildable modules — function bodies in the interface and migration files are intentionally stubbed so they read as specifications. `generateGeometry-star.t[...]

## The one-line summary
Build the implemented feature set (Appendices A–F). Drop the Live State API + hardcoded credentials, the Replit coupling, and debug/backup files (Appendix G). Implement generation once in `share[...]
