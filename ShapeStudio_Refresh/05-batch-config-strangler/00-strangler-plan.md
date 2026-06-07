# Batch Config Strangler — Increment 1

Rebuilds `BatchConfigDialog` (11,433 lines, driven by the ~533-field flat
`BatchConfigSettings`) **incrementally**, by standing new composed sub-configs and
per-section panels up *alongside* the old dialog and migrating one section at a time.
No big-bang rewrite; the app keeps working throughout. This proves AR-1/AR-3/AR-6 on
the real code (see `01-Master-Brief.md §4` and `03-architecture/Architecture-Review.md`).

## The strangler loop (per section)

1. **Descriptor** — transcribe the section's flat field names once (`strangler-adapter.ts`).
2. **Collapse/expand** — `collapse*` reads flat → composed; `expand*` writes composed → a
   *partial* flat object. Both reuse the generic `collapseNumeric`/`expandNumeric` /
   `collapseColor`/`expandColor` in `mode-value.ts`.
3. **Panel** — a small component bound to the composed sub-config (`SizingPanel.tsx`),
   reusing `ModeValueControl` for every range/fixed/incremental block.
4. **Bridge & swap** — mount `…PanelSection` where the old markup was; it collapses the
   live config in and spreads `expand*` back out, so untouched fields pass straight
   through. Once trusted, **delete** the old section's code. That section is strangled.

## What's in this increment

| File | Role |
|---|---|
| `mode-value.ts` | Canonical lossless `NumericModeValue` / `ColorModeValue` + the generic flat↔composed adapters and descriptor types. **The keystone.** |
| `batch-config-sections.ts` | Composed section types. `sizing`, `shapeParams`, `stroke` fully modelled; the rest scaffolded with their `shared/schema.ts` line ranges. |
| `strangler-adapter.ts` | Per-field descriptors + section and whole-config `collapse`/`expand`. |
| `SizingPanel.tsx` | A real decomposed panel + reusable `ModeValueControl` + the drop-in `SizingPanelSection` bridge. |
| `batch-config-roundtrip.test.ts` | Vitest gate: `expand(collapse(f))` is lossless for every migrated section, in every mode. |

Three sections (sizing, shapeParams, stroke) go end-to-end so the pattern is proven and
repeatable. Names are placeholders — preserve semantics, not identifiers. The `.tsx`
imports the repo's existing `@/components/ui/*`.

## Why this order

`sizing` / `shapeParams` / `stroke` first because they're the cleanest fit for the generic
`NumericModeValue`/`ColorModeValue` adapters — they validate the keystone with the least
noise. Then, in rough increasing difficulty:

- **transform, generation count, blend/compositing** — more `NumericModeValue` blocks; trivial once the pattern holds.
- **fill** (`schema ~L1142–1360`) — large but regular: solid colour is a `ColorModeValue`; each gradient centre X/Y and the conic angle are `NumericModeValue`s (note these use `fixedKind: 'fixed'`, spelled `…` with `Mode: 'fixed'|'range'|'incremental'`).
- **distribution** (`L935–1003`) — pattern + grid/wave/ellipse/spiral; `gridOffsets`/`shapeMasking`/`cellConstraints` are *already* nested objects, so they lift over almost as-is.
- **position** (`L1064–1110`) — **special case, do last.** It adds a `directional` kind and grid-aware modulation (`'off'|'grid-col'|'pixel-value'|'shape-count'`) that don't fit the generic `NumericModeValue`. Give it a bespoke `PositionModeValue` + descriptor.

## Parity gating (AR-2 / AR-5)

- Stand up Vitest first (see `04-reference-implementation/generation-parity.test.ts`).
- `batch-config-roundtrip.test.ts` must pass for a section **before** its old dialog code
  is deleted. The round-trip invariant is what guarantees the swap can't silently change a
  saved recipe.
- Keep the existing generation-parity test green throughout — the adapter only regroups
  fields; it must not change generator output for any seed.

## Out of scope here

The shadow/glow **server-parity gap** (Appendix D/G) is an AR-1 *generation-core* issue,
not a config-shape issue — handle it in the shared render core, separately from this
config migration.
