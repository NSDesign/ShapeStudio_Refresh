# Appendix E — Export System (Client + Server High-Resolution) & Print

Covers client-side export (all formats), server-side high-resolution/large-format export with tiling and SSE progress, the render-mode selector, batch export, and the print configuration model. All implemented and verified. (The deprecated Live State API is **not** part of export — see Appendix G.)

---

## E.1 Render-mode selector

`ExportRenderMode = 'auto' | 'client' | 'server'`:
- **client** — render and encode in the browser.
- **server** — render via headless Chromium + Sharp on the server (for large/print output).
- **auto** — choose automatically: the client requests an **estimate** (`POST /api/export/high-resolution/estimate`); if the output exceeds browser canvas/memory limits, it routes to the server and shows a preflight dialog.

## E.2 Client export

`client/src/lib/imageExport.ts` (`ImageExporter`). Supported formats:
```ts
type ImageFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'bmp' | 'tiff' | 'pdf';
```
- **Raster** (PNG/JPEG/WebP/AVIF/BMP) via canvas `toBlob`. JPEG/WebP/AVIF honour a `quality` value.
- **TIFF** via `utif`, with `TiffCompression = 'none' | 'deflate'`, 8/16-bit depth, and embedded DPI metadata (`dpiEmbedder.ts`). Targets professional printing.
- **PDF** via `jsPDF`.
- **ICC colour management**: sRGB ICC profile embedding for PNG and JPEG (`iccProfile.ts`, `embedIccInPng` / `embedIccInJpeg`); BMP/WebP do not embed ICC.
- Common export options: scale, scope (all / selected / artboard), include background + background colour, margins (uniform or per-side), include adornments / grid / artboard geometry, include-type-in-filename. (See `DEFAULT_EXPORT_SETTINGS` / `ExportSettingsConfig` in `shared/schema.ts`.)

## E.3 Server high-resolution export

`server/services/exportService.ts` (`highResExportService`) — required for output that exceeds browser limits (e.g. A0+ at 600 DPI, 16-bit TIFF).
- **Renderer:** `puppeteer-core` (headless Chromium) renders the composition; `sharp` encodes/processes the output.
- **Request/result types:** `HighResExportRequest` / `HighResExportResult`. The request carries shapes, groups, artboard (incl. DPI + print config), and export settings (`format: tiff|png|jpeg|webp|pdf`, `bitDepth: 8|16`, `compression: none|deflate`, `scale`, `includeBleed`, `includePrintMarks`, `backgroundMode`, etc.).
- **Estimation:** `getExportEstimate(artboard, exportSettings)` returns whether server export is required, estimated duration, estimated file size, memory required, and whether tiling is needed.

**Tiled rendering (large prints):**
- `planTiles()` computes an optimal tile grid when the image exceeds single-pass limits.
- Thresholds (`TILE_THRESHOLDS`): ~8000px base tile size, 1000px minimum tile; pixel-count and byte-count ceilings (`maxSinglePassPixels` / `maxSinglePassBytes`).
- Tiles are rendered and composited sequentially (memory-bounded), then stitched, with metadata preserved.

## E.4 SSE progress streaming

Real-time progress for long/tiled exports via Server-Sent Events. Endpoints (in `server/routes/export.ts`):
- `POST /api/export/highres/start` → creates a session, returns `exportId` + stream/download URLs.
- `GET  /api/export/highres/stream` → SSE event stream.
- `GET  /api/export/highres/download/:exportId` → fetch completed file.
- `DELETE /api/export/highres/:exportId` → cancel.
- `GET  /api/export/highres/status/:exportId` → poll status.

SSE event types: `phase` (`preparing|rendering|stitching|encoding`), `tile` (per-tile render/stitch progress), `progress` (overall % + `estimatedSecondsRemaining`), `complete` (downloadUrl, filename, sizeBytes), `error`, `heartbeat`. Client integration via typed callbacks (`executeServerExportWithSSE`, `onPhase/onTile/onProgress`). Server export must tolerate client disconnect mid-render.

## E.5 Batch export & projects

- **Batch export** (`POST /api/export/batch`, `exportService.startBatchExport`): generates N images from the current generation sets server-side, optionally saving project JSON per image and packaging as ZIP. Status via `GET /api/export/status/:exportId`; download via `GET /api/export/download/:exportId` and `GET /api/export/files/:exportId/:filename`.
- **Export jobs** are persisted in the `export_jobs` table (`exportId`, `userId`, `status`, `progress`, `config`, `results`, `error`, timestamps) so status survives and can be polled.
- **Projects** (`server/services/projectService.ts`, client `projectManager.ts`): full application state saved/loaded as JSON. `POST /api/projects/save`, `GET /api/projects/download/:filename`.
- **Cleanup** (`POST /api/export/cleanup`): removes old exports/projects (cron-friendly).
- Static info: `GET /api/export/formats`, `GET /api/export/defaults`.

## E.6 Print configuration

`PrintConfig` (`shared/schema.ts`, `DEFAULT_PRINT_CONFIG`) models professional print output:
- `OutputSpecs` — dimensions + DPI; `PrintUnitType: pixels|mm|cm|inches` (unit conversion based on artboard DPI).
- `BleedSettings` — bleed area around artboard.
- `SafeZoneSettings` — inner safe margin.
- `PrintMarksSettings` — crop/registration marks; `PrintMarksScaleMode: none|percent`.
- `BackgroundExportSettings` / `BackgroundMode: transparent | artboard | custom`.
- `PrintableOverlays` — which overlays render in output.

Bleed, safe zone, and print marks render correctly at any DPI and integrate with both batch and server export. A `TiffPreflightModal` provides pre-flight UX before large TIFF exports, and an `ExportProgressOverlay` shows elapsed time during export.

## E.7 Parity & defaults guard

Export defaults are defined once in `shared/exportSchema.ts` (`DEFAULT_BATCH_EXPORT_SETTINGS`) and asserted against the server via `shared/exportParityTest.ts` (`validateExportSettingsParity` / `assertExportSettingsParity`). Keep this guard so client and server never drift on export configuration.
