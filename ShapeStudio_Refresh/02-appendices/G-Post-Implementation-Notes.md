# Appendix G — Post-Implementation Notes

This appendix is intentionally **not** part of the build target. It records what was deliberately excluded, what is incomplete, what is planned-only, and the doc-vs-code corrections — so the rebuild team knows the boundaries and doesn't accidentally resurrect dead code.

---

## G.1 Removed / deprecated — do NOT carry forward

### Live State API + API Call Generator (deprecated, treat as removed)
A REST API that let external scripts capture the app's live state and trigger generation/export remotely. **Excluded from the rebuild entirely.**

What it comprises in the current repo:
- `server/routes/liveApi.ts` — `POST /api/live/sets/enabled`, `/api/live/sets/test-generation`, `/api/live/sets/execute` (wired via `setupLiveApiRoutes`).
- `server/routes/export.ts` — the `POST /api/live/execute` handler.
- The versioned generator endpoints `POST /api/export/batch/:version` (multi-version API-call generation).
- Client: `client/src/components/ApiCallGenerator.tsx` (the only client caller of `/api/live`).
- Docs: `docs/api-usage.md`, `docs/api-reference.md`.
- The `x-api-key` auth branch in `server/routes.ts`.

Why it's safe to drop (verified):
- It is **fully decoupled from the export pipeline.** High-resolution export uses its own endpoints (`/api/export/highres/*`, `/api/export/high-resolution`) and depends only on `exportService`. `liveApi.ts` is imported in exactly one place (`routes.ts`), and only `ApiCallGenerator.tsx` calls `/api/live` on the client. Removing the Live API breaks nothing user-facing.

**Security note (important):** the Live API contains a **hardcoded API key** (`'3211d3f332fsss4t4tbebw5r653765h6brb4'`) and a hardcoded user id (`'21294'`) in the request handlers. These must **not** be reproduced. If any remote-control capability is ever wanted later, it should be a fresh, properly-authenticated design — not a port of this.

### Replit-specific coupling (replace, not port)
- Production auth wired to Replit's OIDC (`server/replitAuth.ts`); replace with a generic OIDC provider or `passport-local`.
- `.replit`, `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-runtime-error-modal`, and Replit autoscale deployment assumptions — replace with standard hosting/build.

### Dead / debug code
- `client/src/components/Sidebar_backup.tsx` — backup of the sidebar; not used.
- `server/routes/canvasTest.ts` (`registerCanvasTestRoutes`) — debug routes; not needed in production.

## G.2 Incomplete / partial — known gaps

- **Shadow/glow server-export parity (gap).** Drop shadow, outer glow, inner shadow, inner glow render in the **client** but are absent from the **server** render path, so high-resolution/server export currently omits them. Recommended to complete in the rebuild (implement in shared render logic). *(See Appendix D.1.)*
- **Physics simulation (incomplete).** A physics option surfaces in the UI (`BatchConfigDialog.tsx`, `GenerationSetsInterface.tsx`) and a `physics` branch exists in the scatter algorithm, but there is no working physics simulation wired into the main generation/render path. Treat as **not implemented**; exclude from the build target unless explicitly specified.
- **Temporal variation (disabled).** `evolutionMode` is hardcoded to `'none'` in `BatchConfigSettings` — a placeholder for a future animation/evolution feature. Not functional.
- **Extended locking system (partial).** `SetLocks` exists with at least a `composite` lock; the broader per-operation locking described in docs is only partially realised. Build only the locks actually present (verify against `SetLocksSchema`).
- **Aspect-ratio post-scaling (planned, Size Constraints "Phase 2").** Only `sizeConstraintMode: none|min|max|avg` is implemented; the planned post-scale-to-aspect-ratio (16:9, 4:3, etc.) is not.

## G.3 Known bug recorded in the repo

- **Set Visibility Toggle bug** (`docs/temp.md`, unresolved): toggling one generation set's visibility can cause other sets to revert to a stale rendered appearance even though their stored config is correct — likely a re-render using cached/stale generation configs, or persistence-restore triggered by the visibility toggle. The rebuild should ensure visibility toggles re-render from current config and never restore stale state. (Flag for QA.)

## G.4 Planned-only — documented but never built (exclude)

From `docs/future-features.md`, these are design write-ups with **no implementation**. Do not build unless requested:
- Batch Export Queue
- Multi-format Batch Processing (export same composition to multiple formats in one job)
- Set Repetition Index Control (property progressions driven by repetition index)
- Advanced Multi-Filter System for the Sets Manager
- Shape Selection Groups (the reusable filter abstraction; note: Echo's `applyTo` was named to be forward-compatible with it, but the abstraction itself doesn't exist)
- Export Metadata Embedding Audit & Settings Sync
- Export & Save Contextual UI
- Additional Shape-Masking filter types (position/count/color/size/rotation/opacity) — only the grid-position filter is built
- Server-export estimated-time display refinements

## G.5 Documentation-vs-code corrections (because code is authoritative)

- `future-features.md` marks **shadow/glow effects "📋 Planned"** — **incorrect**; they are implemented client-side (Appendix D.1). The rebuild should treat them as implemented (client), and ideally extend to server.
- `future-features.md` is otherwise a useful status ledger, but several "phase" items it lists as implemented were verified directly in code (grid offsets, masking, cell points, echo) — trust the code, use the docs only as a map.
- The in-repo docs describe a richer locking and masking-filter surface than the code delivers (see G.2). Build to the code, not the docs.

---

### One-line summary for the rebuild team
Build the implemented feature set (Appendices A–F). Drop the Live State API and its hardcoded credentials, the Replit coupling, and the debug/backup files. Close the shadow/glow server-parity gap and the set-visibility bug if scope allows. Ignore everything in G.4 unless a stakeholder asks for it.
