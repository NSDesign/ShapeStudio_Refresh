# Appendix F — Persistence, Auth & Data Model

The database schema, what is persisted, project files, and authentication. Implemented and verified. Schema/table names may be renamed in a rebuild.

---

## F.1 Database & ORM

- PostgreSQL via `@neondatabase/serverless`; Drizzle ORM; migrations applied with `drizzle-kit push` (`npm run db:push`). Config in `drizzle.config.ts`; connection in `server/db.ts`.
- Access layer: `server/storage.ts` (a `storage` object with typed async methods). Routes never touch the DB directly — they go through `storage`.

## F.2 Tables (`shared/schema.ts`, `pgTable`)

1. **`sessions`** — session store for `connect-pg-simple` (required by the OIDC/passport login flow).
2. **`users`** — account identity: `id` (subject), email, first/last name, profile image URL, timestamps. (`User`, `UpsertUser`, `InsertUser` types.)
3. **`user_preferences`** — per-user app state (JSONB-backed config). Stores:
   - `exportSettings` (`ExportSettingsConfig`),
   - `appSettingsDefaults` (`AppSettingsDefaults`),
   - saved artboards (`SavedArtboard[]`),
   - sidebar configuration (`SidebarSectionConfig`, default `DEFAULT_SIDEBAR_SECTIONS`).
   - Validated via `insertUserPreferencesSchema` / `updateUserPreferencesSchema`.
4. **`shape_set_presets`** — named, reusable presets of generation-sets data per user. (`ShapeSetPreset`, `InsertShapeSetPreset`.)
5. **`export_jobs`** — persistent export job state: `exportId` (PK), `userId` (FK → users, cascade), `status` (`queued|processing|completed|failed`), `progress` (JSONB), `config` (JSONB), `results` (JSONB), `error` (text), `createdAt`, `completedAt`. (`ExportJob`, `InsertExportJob`.)

> Note: **generation sets are persisted via the storage layer** (`saveUserGenerationSets` / `loadUserGenerationSets`) keyed by user, alongside the `currentSetId`. In a rebuild, decide whether these live in their own table or remain serialized under user state — the public behaviour is "a user's generation sets + current selection persist server-side."

## F.3 `storage` methods (server/storage.ts)

Reproduce equivalents of:
- Users: `getUser`, `upsertUser`, `getAllUsers`, `deleteUser`.
- Preferences: `getUserPreferences`, `upsertUserPreferences`, `createDefaultUserPreferences`.
- Generation sets: `saveUserGenerationSets(userId, sets, currentSetId)`, `loadUserGenerationSets(userId)`.
- Shape-set presets: `saveUserShapeSetPreset`, `loadUserShapeSetPresets`, `deleteUserShapeSetPreset`.
- (Export-job persistence is used by the export service.)

## F.4 Persistence-related API routes (server/routes.ts)

All behind `conditionalAuth` (see F.6):
- `GET/PUT /api/user/preferences`
- `GET/POST /api/user/generation-sets`
- `GET/POST /api/user/shape-set-presets`, `DELETE /api/user/shape-set-presets/:id`
- `GET /api/auth/user`, `GET /api/protected`
- Admin: `GET /api/admin/users`, `DELETE /api/admin/users/:userId`

Client hooks that consume these: `useUserPreferences`, `useGenerationSetsPersistence`, `useShapeSetPresets`, `useAuth` (with debounced saves for preferences/app settings).

## F.5 Project files (full-state portability)

Separate from DB persistence: a **project file** is the entire application state serialized to JSON, downloadable and re-loadable (`client/src/lib/projectManager.ts`, `server/services/projectService.ts`). This is how users save/share/restore complete compositions independent of their account. Project files must remain loadable across versions via the migration helpers (F.7).

## F.6 Authentication

- **Production:** OIDC via `openid-client` + `passport` (`server/replitAuth.ts`, `setupAuth`, `isAuthenticated`). Sessions in PG (`sessions` table).
- **Development:** auth is bypassed — a mock `dev-user` is injected; no login.
- **`conditionalAuth` middleware:** in dev, injects the mock user; in production, tries an optional `x-api-key` header (matched against `process.env.API_KEY`) and otherwise falls back to OIDC.

> **Rebuild action:** the production auth is wired to **Replit's** identity provider. Replace it with a generic OIDC provider or use the already-present `passport-local` for email/password. Also remove the `x-api-key` middleware branch — it exists only to support the deprecated Live State API (Appendix G), and a hardcoded key appears elsewhere in that API. Auth for the app proper should rely on sessions/OIDC only.

## F.7 Migrations / backward compatibility

The schema ships migration helpers so old data still loads:
- `migrateSizeConstraintMode()` — converts legacy `useMin/Max/AvgWidthHeight` + `maintainAspectRatio` flags to the unified `sizeConstraintMode`.
- `migrateBatchConfigSettings()` — normalizes older batch-config shapes.
- `EnhancedBatchConfig.version` + ISO-string timestamps support versioned migration.

A rebuild must provide equivalent forward-migration on load for both project files and persisted generation sets, or it will break users' saved work.
