# ShapeStudio — Redevelopment Brief (Master)

**Source of truth:** the ShapeStudio codebase (`github.com/NSDesign/ShapeStudio`). This brief was reverse-engineered from the actual code. Where the in-repo docs (`replit.md`, `docs/future-features.md`, `docs/temp.md`) disagree with the code, the code is authoritative.

**Scope of this brief:** everything required to rebuild a faithful equivalent of the application as it currently functions. It describes **fully implemented features only**. Deprecated, incomplete, planned, and removed items are deliberately excluded from the body and recorded separately in *Appendix G — Post-Implementation Notes*.

**Companion documents (per-feature appendices):**
- **A — Shape System & Canvas**
- **B — Generation System & Configuration Schema**
- **C — Distribution, Grid & Masking**
- **D — Effects, Color & Echo / Motion Trails**
- **E — Export System (Client + Server High-Resolution) & Print**
- **F — Persistence, Auth & Data Model**
- **G — Post-Implementation Notes (deprecated / incomplete / planned)**

---

## 1. Product summary

ShapeStudio (internally "Shape Editor") is a web application for **procedurally generating, composing, and exporting geometric vector compositions**. It targets designers and digital artists who want controlled-random generation of large shape compositions with fine-grained property control, then export to screen or professional print formats.

The core loop is: **configure → generate → arrange → render → export**. A user defines one or more *generation sets* (each a complete recipe of shape types, counts, sizing, colour, distribution, effects, and transforms), the engine generates shapes from those recipes onto an infinite canvas with a defined artboard, and the result is exported as raster/vector files or large-format print files.

Two things define the product's character and must be preserved:

1. **A single, large, declarative configuration object** (`BatchConfigSettings`) drives generation. Almost every visual behaviour is a field on this object with a *mode* (typically `range` / `value|define` / `incremental`), so outputs are reproducible recipes rather than one-off manual edits.
2. **Client/server render parity.** The same generation and rendering logic exists in two places: the browser (live preview + standard export) and the Node server (high-resolution/large-format export). Shared logic lives in `shared/` and is consumed by both. A parity test guards configuration drift.

---

## 2. Technology stack

Keep the existing stack unless a replacement is clearly justified (the user's instruction). The stack is mainstream and well-suited to the app; no change is recommended except removing Replit-specific coupling (see §8).

**Frontend**
- React 18 + TypeScript (strict), built with Vite 5.
- Routing: `wouter` (lightweight).
- Server state / data fetching: TanStack Query 5.
- UI: shadcn/ui on Radix UI primitives; Tailwind CSS 3; `lucide-react` icons; `framer-motion` for motion.
- Rendering: HTML5 Canvas 2D with a custom rendering pipeline (no WebGL).
- Forms/validation: `react-hook-form` + `zod`.

**Backend**
- Node (ESM) + Express 4. Dev runner `tsx`; production bundle via `esbuild`.
- Server-side rendering for large exports: `puppeteer-core` (headless Chromium) + `sharp`; `utif` for TIFF; `jspdf` for PDF; `jszip` / `node-7z-archive` for packaging; `pako` for compression.
- Validation shared with the client via `zod` + `drizzle-zod`.

**Database & sessions**
- PostgreSQL via `@neondatabase/serverless`.
- ORM: Drizzle (`drizzle-orm`, `drizzle-kit` for migrations: `db:push`).
- Sessions: `express-session` + `connect-pg-simple` (PG-backed). `memorystore` available as a fallback.

**Auth**
- Production: OpenID Connect via `openid-client` + `passport` (currently wired to Replit's identity provider — see §8, this must be replaced with a generic OIDC/auth provider in a rebuild).
- Development: a mock user is injected; no login required.

**Repository layout** (monorepo, three roots sharing types)
```
client/    React SPA (client/src/{components,hooks,lib,pages,utils})
server/    Express app (server/{routes,services,lib,validation})
shared/    Types + parity-critical logic imported by BOTH client and server
```
Path aliases: `@/…` → `client/src`, `@shared/…` → `shared`. Build = `vite build` (client) + `esbuild` bundle (server) → `dist/`.

---

## 3. Architecture & data flow

**End-to-end flow:** user interaction → React state (`useShapeEditor` and sibling hooks) → shape generation (`shared` + `client/src/lib`) → Canvas rendering (live preview) → export pipeline (client for normal sizes, server for large/print). Persistence runs alongside (preferences, generation sets, presets, project files, export jobs).

**Three layers to reproduce:**

1. **State & UI layer (client).** A small number of large hooks own application state. `useShapeEditor` (~5,600 lines) is the central hook: shapes, groups, selection, enabled shape types, scatter settings, generation sets, and all editing operations. Supporting hooks: `useGenerationSets`, `useGenerationSetsPersistence`, `useUserPreferences`, `useShapeSetPresets`, `useAuth`. The main composed UI is `ShapeEditor.tsx` → `Sidebar.tsx` (~9,300 lines, the control surface) + `Canvas.tsx` (~1,300 lines, the viewport) + dialogs (`BatchConfigDialog`, `SetsManagerDialog`, `ExportDialog`, `ProjectDialog`, `TiffPreflightModal`, etc.).

2. **Generation & rendering layer (shared + duplicated).** Shape construction, property application, distribution, grid offsets, masking, echo, colour, and effects. The browser version lives in `client/src/lib`; the server version in `server/lib`; parity-critical helpers in `shared/`. See Appendix B for the full generation pipeline order.

3. **Server layer.** Express routes (`server/routes/export.ts`, `routes.ts`), services (`exportService`, `projectService`), and `server/lib` processors (`batchConfigProcessor`, `shapeGenerator`, `generationSetProcessor`, `distributionLayouts`, `distributionAlgorithm`, `canvasRenderer`, `positionModulationResolver`).

**Parity requirement (critical):** any generation behaviour added must produce identical output in browser preview and server export. The repo enforces this with `shared/exportParityTest.ts` (asserts server export defaults match `shared/exportSchema.ts`). A rebuild must keep an equivalent guard, and should ideally go further by hoisting *all* duplicated generation logic into `shared/` so there is one implementation rather than two. (Today some logic is genuinely duplicated between `client/src/lib` and `server/lib`; this is the single biggest source of latent parity bugs and is worth consolidating in a rebuild.)

**Development discipline (from `replit.md`, recommended to keep):** build and verify each feature fully on the client first; add server parity only once the client behaviour is correct.

---

## 4. Architecture requirements (rebuild constraints)

These are **binding constraints** for a rebuild (and the priority refactor targets if the codebase is kept in place). They exist because the current application, while fully functional, carries structural issues that are measured and explained in the companion **ShapeStudio Architecture Review**. Each constraint below removes a *verified, latent failure mode* — not a stylistic preference. **None requires changing the technology stack.**

**AR-1 — One generation core, living in `shared/`.** All shape-generation and property-application logic (geometry, sizing, position, fill/stroke, effects, transforms, distribution math) must be implemented once as **pure, runtime-agnostic functions in `shared/`**, of the form `(config, seed, index) → { geometry, properties }`, with no DOM or canvas dependency. Client and server both import this core; each owns only a **thin renderer** (browser Canvas2D vs node-canvas/Sharp).
- *Why:* today this logic is duplicated across `client/src/lib` (~5,600 lines) and `server/lib` (~3,700 lines), and the server imports client types backwards (`server/lib/shapeGenerator.ts` → `client/src/lib/shapeTypes`). That duplication is the root cause of the verified shadow/glow server-parity gap (Appendix D/G).
- *Concrete starting point:* see the companion **Generation Core Interface** draft.

**AR-2 — Parity enforced by a golden-output test in CI.** The build must include an automated test that runs a fixed set of seeded configurations through the shared core and asserts the **serialized output is identical across runtimes**, plus pixel/structural checks against stored golden references. This supersedes the current defaults-only guard (`shared/exportParityTest.ts`).
- *Why:* the app's core correctness property — "same config → same image on client and server" — is currently verified by **no automated test**.

**AR-3 — Configuration as composed sub-objects on a single mode primitive.** Decompose the current ~**533-field flat** `BatchConfigSettings` into composed, independently-typed, independently-validated sub-configs (`distribution`, `sizing`, `position`, `fill`, `stroke`, `effects`, `transform`, `echo`, `harmony`). Model the pervasive `range | value | incremental` pattern **once** as a generic `ModeValue<T>` discriminated union and reuse it everywhere. Keep serialized keys stable (or provide migration) so existing project files load.
- *Why:* the flat object collides unrelated features in one namespace, makes defaults and migrations fragile, and forces the 11,433-line `BatchConfigDialog.tsx`.

**AR-4 — Selector-based state store; no prop-drilling.** Editor state must live in a selector-subscription store (Zustand fits well) or, at minimum, domain hooks behind Context (`useShapes`, `useSelection`, `useGenerationSets`, `useArtboard`). Components subscribe to the slices they use.
- *Why:* today a single **5,584-line** hook (`useShapeEditor`) is prop-drilled through **69 props** into `Sidebar` and **35** into `Canvas`, causing whole-editor re-renders and making state effectively untestable.

**AR-5 — Tests, lint, and CI from day one.** Vitest (unit tests + the AR-2 parity suite), ESLint + Prettier, and a CI gate running `tsc` + lint + tests on every change — established *before* feature work, so each layer ships safely.
- *Why:* the current project has **no test framework, linter, or CI** (only `tsc`).

**AR-6 — UI composed along the sub-config boundaries.** With AR-3 and AR-4 in place, split the configuration UI into per-section panels (`<FillPanel>`, `<DistributionPanel>`, `<EffectsPanel>`…), each bound to its sub-config and store slice, replacing the monolithic `BatchConfigDialog.tsx` (11,433) and `Sidebar.tsx` (9,312). Encapsulate cross-cutting UI gotchas (e.g. the dialog `z-index` requirement on every `SelectContent`) in shared wrapper components rather than repeating them per instance.

For the full evidence base, ranked rationale, and a refactor-vs-rebuild sequencing plan, see the companion **ShapeStudio Architecture Review**.

---

## 5. Feature inventory (implemented — the build target)

Each item below is verified present and functional in the code. Detail and schemas are in the named appendix.

**Shape system (Appendix A)**
- 31 shape types: rectangle, rounded-rectangle, square, rounded-square, circle, ellipse, triangle, right-triangle, trapezoid, pentagon, hexagon, rhombus, parallelogram, kite, semicircle, heart, arrow, cross, line, line-vector, polygon, star, chunk, blob, ring, cubic (bézier), bezier, smooth-spline, spline-circle, spline-ellipse, spline-ring.
- Point-level geometry with regeneration; per-shape transforms (translate/rotate/scale/skew).
- Boolean operations: **union, subtract, intersect, exclude** (`BooleanOperations`).
- Hierarchical grouping.

**Canvas engine (Appendix A)**
- Infinite, layered canvas with pan/zoom, multi-touch, marquee + additive multi-selection, real-time rendering.
- Artboard with presets, background colour, and DPI; artboard sync (auto-select new artboard, safe deletion).

**Generation system (Appendix B)**
- Single and multi-set generation. A **generation set** is a complete recipe; multiple sets compose into one composition with global ordering, z-index, and repetition control.
- The central `BatchConfigSettings` object: sizing (with `none/min/max/avg` constraint), positioning (with grid-aware modulation), per-shape-type properties, fill (solid + linear/radial/conic gradients), stroke, blur + shadow/glow effects, transforms, blend modes, compositing operations.
- Generation count modes: `range` / `fixed` / `incremental`. Per-set repetition (`use-global` / `fixed` / `range`) and global repetition. Edge-case strategy when sets < batch count: `hold` / `cycle` / `random` / `stop`.
- Set-level controls: visibility/opacity, blend mode, compositing operation, transform, artboard alignment/fit, locks.
- Reproducible seeded randomness (recipes regenerate consistently).

**Distribution, grid & masking (Appendix C)**
- Distribution layouts: **grid, wave, ellipse/ring, spiral, auto-distribute**, plus scatter placement (on-points / inside-area).
- Sorting across ~19 keys (layer, size, fill-color, opacity, angle, centroid, curvature, etc.), scoped per-generation or per-batch.
- Grid spacing modes (`define` / `auto-centered` / `auto-edge-to-edge`), grid randomization, and grid offset system (alternating + pattern offsets, presets, value modes).
- Shape Masking: top-level grid-position filter (alternating/pattern, invert, row/column priority).
- Cell-based rendering (Cell Points / cell constraints).

**Effects, colour & motion (Appendix D)**
- Gaussian blur — full client + server parity.
- Drop shadow, outer glow, inner shadow, inner glow — **client render implemented** (note: client-only; see Appendix D / G for export-parity caveat).
- Colour harmony system + HSL controls; gradient generation (linear/radial/conic).
- Echo / Motion Trails — complete: set/shape/both scope, three drivers, three direction modes, per-echo opacity/blur/scale/rotation, HSL colour shift, apply-to filters, jitter, and per-set override.

**Export & print (Appendix E)**
- Client export: PNG, JPEG, WebP, AVIF, BMP, TIFF (8/16-bit), PDF. sRGB ICC embedding for PNG/JPEG.
- Server high-resolution export: headless-Chromium render + Sharp, with **tiled rendering** for very large prints, export-size/time estimation, and **SSE progress streaming**.
- Render-mode selector: `auto` / `client` / `server`.
- Print configuration: output specs, bleed, safe zone, print marks, background mode (transparent/artboard/custom), units (px/mm/cm/in), DPI.
- Batch export of multiple images, optional project-file saving, ZIP packaging; server-side export jobs with status polling.

**Persistence & accounts (Appendix F)**
- PostgreSQL via Drizzle. Tables: `sessions`, `users`, `user_preferences`, `shape_set_presets`, `export_jobs`.
- Saved per user: export settings, app-setting defaults, saved artboards, sidebar configuration, generation sets (+ current set), shape-set presets.
- Project files: full application state saved/loaded as JSON (download + restore).
- Auth: OIDC in production; mock user in development.

---

## 6. Non-functional requirements

- **Reproducibility:** identical configuration must yield identical output (seeded RNG), and client preview must match server export pixel-for-pixel within format limits.
- **Performance:** real-time canvas interaction at typical composition sizes; export must scale from small raster up to A0+ at 600 DPI via tiling without exhausting memory.
- **Type safety:** end-to-end TypeScript; runtime validation with `zod` at every server boundary and on project-file load.
- **Backward compatibility:** project files and saved sets from prior versions must still load. The current code does this via migration helpers (e.g. `migrateSizeConstraintMode`, `migrateBatchConfigSettings`); a rebuild needs an equivalent versioned-migration mechanism (`EnhancedBatchConfig.version` exists for this).
- **Resilience:** server export must tolerate client disconnects mid-export; long exports must stream progress and be cancellable.

---

## 7. Suggested build sequence

A rebuild should follow the same client-first discipline and roughly this order, because later layers depend on earlier ones:

1. **Foundations:** monorepo, shared types/schema, Tailwind/shadcn, canvas viewport (pan/zoom/selection), artboard.
2. **Shape system:** all 31 shape types + point geometry + transforms + boolean ops + grouping.
3. **Generation core:** `BatchConfigSettings` schema, single-set generation pipeline, seeded RNG, live preview.
4. **Properties:** sizing, positioning, fill (solid + gradients), stroke, opacity — with the `range/value/incremental` mode pattern.
5. **Distribution & grid:** layouts, sorting, grid offsets, masking, cell constraints.
6. **Multi-set system:** generation sets, set-level controls, z-index, repetition, edge-case strategy, sets manager.
7. **Effects & colour:** blur, shadow/glow, colour harmony, echo/motion trails.
8. **Client export:** all formats + ICC + print config.
9. **Persistence:** DB schema, preferences, sets/presets, project files, auth.
10. **Server parity & high-res export:** server generation/render that matches the client, tiled rendering, SSE progress, estimation, batch jobs. Keep a parity test from step 3 onward.

---

## 8. Decisions & deviations baked into this brief

- **The Live State API is excluded and treated as removed.** It is fully decoupled from the export pipeline (verified), so dropping it does not affect any user-facing feature. See Appendix G for exactly what to remove and why (including a hardcoded credential that must not be carried forward).
- **Server-side high-resolution export is retained** as a first-class feature. It uses its own dedicated REST + SSE endpoints (`/api/export/highres/*`, `/api/export/high-resolution`), not the Live API. The server is required for large prints (browser canvas/memory limits, TIFF encoding, tiling); this is legitimate and unrelated to the deprecated API.
- **Replit coupling should be removed.** Production auth is wired to Replit's OIDC and the build assumes Replit hosting (`.replit`, Replit Vite plugins). A rebuild should swap to a generic OIDC provider (or email/password via the existing `passport-local` dependency) and standard hosting. This is the only stack-level change recommended.
- **Schemas are included** (Appendices B–F) and may be renamed freely in a rebuild; only the semantics must be preserved.
- **Consolidate duplicated generation logic into `shared/`** where the current code duplicates between `client/src/lib` and `server/lib`. Same observable behaviour, fewer parity bugs.

---

## 9. Open items the rebuild team should confirm

- **Auth model for the rebuild:** generic OIDC, email/password, or anonymous/local-only? The data model assumes a `users` table and per-user persistence; if accounts are dropped, persistence becomes local/browser storage instead.
- **Multi-user/sharing scope:** the current app is single-user-per-account with no sharing. Confirm that stays.
- **Shadow/glow on server export:** these effects render in the client but not in the current server export path. Confirm whether the rebuild must achieve full server parity for them (recommended) or accept client-only (preview/standard export) as today. See Appendix D/G.
