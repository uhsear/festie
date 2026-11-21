# Festie Architecture

## Overview

Festie is a real-time festival crew coordination app built as a monorepo. The backend is a Node.js 22 server using Express 5 and TypeScript, with Socket.IO 4, PostgreSQL 16, and Redis 7. The frontend is a React 19 SPA with TanStack Router, Zustand, and Tailwind CSS 4, built with Vite 8. A native mobile app (Expo SDK 58, expo-router) uses the same API. A shared TypeScript package provides stores, hooks, types, and utilities consumed by both the web app and the mobile app.

**Stack:** Node.js 22 + Express 5 + TypeScript + Socket.IO 4 + PostgreSQL 16 + Redis 7 | React 19 + Vite 8 + TanStack Router + Zustand + Tailwind CSS 4 | Expo SDK 58 + React Native 0.88

**Production runtime:** the esbuild bundle `dist/server.js` runs under plain `node` (one instance, no cluster mode). `npm run dev` and `npm start` run the TypeScript source with `tsx`. See [Runtime](#runtime).

---

## Backend Architecture

### Entry Point: `server.ts`

The server is a thin orchestrator. It delegates all infrastructure setup to extracted modules:

```
server.ts ─── orchestrator
  lib/app-context/ ─── DI composition (config, DB, Redis, caches, auth, rate limiters)
  lib/middleware.ts ── Express middleware stack (security, CORS, parsing, metrics)
  lib/socket-setup.ts  Socket.IO server + Redis adapter
  lib/shutdown.ts ──── graceful shutdown
  lib/background-tasks.ts ─ leader-only background jobs (timers)
  routes/*.ts ──────── 51 API route modules (factory pattern)
```

`server.ts` calls `createAppContext()` to build the dependency injection container, applies middleware, mounts routes, starts Socket.IO, and registers shutdown handlers. It validates startup configuration (PUBLIC_ORIGIN, SESSION_SECRET, webhook keys) before any initialization runs.

### Dependency Injection: `lib/app-context/`

`lib/app-context/index.ts` is the central composition root. It creates and wires together every infrastructure dependency into a single `deps` object that route factories receive. Extracted sub-modules:

| File | Responsibility |
|------|----------------|
| `index.ts` | Compose config, DB pool, Redis, caches, auth, sessions, utilities |
| `csp.ts` | Content Security Policy header generation |
| `avatar.ts` | Avatar upload validation, resizing (Sharp worker pool), storage |
| `request-helpers.ts` | IP extraction, origin checks, CSRF enforcement |
| `cookies.ts` | Session cookie management (set, clear, parse) |

### Core Library Modules: `lib/`

| Module | Purpose |
|--------|---------|
| `config.ts` | Centralized env vars with typed readers (`readInt`, `readBool`, `readList`) and defaults |
| `schemas.ts` | Zod validation schemas for all API inputs + normalization helpers |
| `rate-limiting.ts` | Multi-tier rate limiting: in-memory (single process) or Redis-backed (shared across processes) |
| `planner-db-pg.ts` | PostgreSQL connection pool, migration runner, store factory |
| `redis.ts` | Redis client, rate limiter, presence store, cache invalidation bus, circuit breaker |
| `middleware.ts` | Express middleware composition (Helmet, CORS, compression, body parsing, metrics, rate limits) |
| `metrics.ts` | Prometheus metrics (prom-client) collection and endpoint |
| `shutdown.ts` | Graceful shutdown (drain requests, close DB/Redis, clear timers) |
| `background-tasks.ts` | Leader-only background job timers (cleanup sweeps, announcements, expiry) |
| `openapi.ts` | OpenAPI 3.0 spec generation from route metadata |
| `emitter.ts` | Typed event emitter for internal pub/sub |
| `reminder-scheduler.ts` | Background scheduler for set reminders (push notifications) |
| `invite-pages.ts` | Crew invite HTML page templates |
| `presence.ts` | Socket.IO presence tracking (online users per festival) |
| `helpers.ts` | Legacy utilities (being migrated to `lib/helpers/`) |
| `logger.ts` | Pino logger with JSON output, sensitive field redaction |
| `email.ts` | Transactional email via Resend (password reset, invites) |
| `audit-middleware.ts` | Express middleware for audit log entries |
| `avatar-pool.ts` | Worker thread pool for Sharp image processing |
| `sentry.ts` | Sentry error tracking integration |
| `instrument.ts` | Sentry preload. The build emits it as `dist/instrument.js`, and the process loads it with `--import` before `dist/server.js` |
| `spotify.ts` | Spotify API client for artist metadata |
| `socket-setup.ts` | Socket.IO server creation + Redis adapter attachment |
| `crypto-auth.ts` | Password hashing (scrypt) + session token hashing (SHA-256) |

Smaller modules: `pagination.ts`, `tracing.ts`, `response.ts` (also defines `ErrorCodes`), `swagger-ui-setup.ts`, `avatar-worker.ts`, `export-worker.ts`, `constants.ts`. The two worker files are separate esbuild entry points, so `dist/` holds `avatar-worker.js` and `export-worker.js` next to `server.js`.

Feature modules sit beside them, one file per feature. Examples: `checkin.ts`, `schedule-diff.ts`, `set-moves.ts`, `time-zone.ts`, `geocode.ts`, `announcements.ts`, `live-location-cache.ts`, `siteplan-upload.ts`. Google and Apple sign-in live in `lib/oauth/` and `lib/auth/sign-in.ts`.

### Helpers: `lib/helpers/`

| File | Purpose |
|------|---------|
| `export-utils.ts` | HTML + ICS export generation, crew filtering |
| `sanitize.ts` | Input sanitization, HTML escaping, log field redaction |
| `validation.ts` | Time, color, festival structure validation |

### Notifications: `lib/notifications/`

Push notification subsystem (FCM for Android, APNs for iOS, Web Push for browsers) with retry and do-not-disturb support.

| File | Purpose |
|------|---------|
| `send.ts` | Firebase Cloud Messaging dispatch (batch + individual) |
| `payload.ts` | Notification payload builders (crew updates, schedule changes, set reminders) |
| `retry.ts` | Exponential backoff retry for failed sends |
| `dnd.ts` | Do-not-disturb time window checks |
| `index.ts` | Module barrel export |
| `apns.ts` | Apple Push Notification service provider (iOS) |
| `webpush.ts` | Web Push sender with VAPID auth (web) |
| `crew-notify.ts` | Crew notifier: grouped queue plus immediate sends |
| `links.ts` | Absolute web links shared by push and email |
| `reengagement.ts`, `reengagement-queue.ts` | After-festival re-engagement triggers and their BullMQ fan-out queue |

### Data Access: `lib/db/stores/`

22 store modules, each exporting CRUD functions that accept a `pool` (pg Pool) parameter. All queries use parameterized SQL (`$1, $2`).

| Store | Tables |
|-------|--------|
| `profiles.ts` | `festival_profiles` -- picks, notes, reminders, live status |
| `crews.ts` | `crews`, `crew_members`, `crew_activity` |
| `festivals.ts` | `festivals`, `festival_stages`, `festival_days`, `festival_sets` |
| `users.ts` | `users` -- accounts, avatars, display names |
| `sessions.ts` | `user_sessions`, `admin_sessions`, `refresh_tokens` |
| `notifications.ts` | `device_tokens`, `notification_preferences` |
| `roles.ts` | `roles`, `user_roles` |
| `audit.ts` | `audit_log` -- user actions, admin operations |
| `polls.ts` | `crew_polls`, `crew_poll_votes` |
| `expenses.ts` | `crew_expenses`, `crew_expense_reminders` -- splits are the `split_with` and `split_amounts` columns |
| `ratings.ts` | `set_ratings` -- post-festival artist ratings |
| `calendar-tokens.ts` | `calendar_tokens` -- ICS feed authentication |
| `email-tokens.ts` | `email_verification_tokens`, `password_reset_tokens` |
| `activity.ts` | `crew_activity` -- crew event feed |
| `announcements.ts` | `festival_announcements` -- admin notices to a festival's attendees |
| `follows.ts` | `festival_follows` -- festivals a user follows |
| `identities.ts` | `user_identities`, `auth_oauth_states` -- Google and Apple sign-in |
| `lineup-imports.ts` | `lineup_imports` -- import history and undo |
| `share-links.ts` | Revocable picks share tokens (`/s/<token>`) |
| `artists.ts` | `artists`, `artist_suggestions` -- the artist repository, the copies that sets and announced lineups hold, and organizer suggestions |
| `artist-visibility.ts` | Which artists an organizer may see: published, own festivals, or created by its organization |
| `festival-lock.ts` | Festival row locks shared by the artist and lineup-import stores |
| `time-releases.ts` | `festival_time_releases` -- per-date "set times are out" claims |

### Routes: `routes/`

51 route modules, each a factory function receiving the `deps` object and returning an Express Router. The types live in `lib/types/`.

```ts
import { Router } from 'express';
import type { RouteDeps } from '../lib/types';

export function createFeatureRoutes({ stores, log, sendSuccess, sendError }: RouteDeps) {
  const router = Router();
  // ...
  return router;
}
```

| Route | Responsibility |
|-------|----------------|
| `crews.ts` | Crew CRUD, member management, invites, join/leave |
| `auth.ts` | Register, login, logout, refresh tokens, change password |
| `export.ts` | HTML/ICS exports, presence list, message export |
| `admin-status.ts` | Admin dashboard: server status, connections, DB stats |
| `share.ts` | Festival sharing, public schedule links |
| `socket.ts` | Real-time: presence, crew updates, festival room management |
| `email-auth.ts` | Email-based auth (magic links, verification, password reset) |
| `account.ts` | Profile settings, avatar upload/delete, display name |
| `admin-users.ts` | Admin user management, search, ban, password reset |
| `festivals.ts` | Festival CRUD, publish, stage/day/set management |
| `lineup-import.ts` | Festival lineup import (CSV or TSV rows, parsed by the client and posted as JSON) |
| `notifications.ts` | Push tokens, notification preferences, mark read |
| `admin.ts` | Admin login, session management, role checks |
| `admin-metrics.ts` | Prometheus metrics endpoint, custom dashboards |
| `profiles.ts` | Join festival, update picks/notes/reminders, live status |
| `crew-features.ts` | Crew feature aggregation (legacy; sub-features extracted below) |
| `crew-invites.ts` | Crew invite link generation and redemption |
| `crew-members.ts` | Crew member management (add, remove, role) |
| `crew-meeting-points.ts` | Crew meeting point CRUD |
| `crew-packing.ts` | Crew shared packing list |
| `crew-polls.ts` | Crew polls and voting |
| `crew-rides.ts` | Crew ride coordination |
| `crew-sos.ts` | SOS signal and crew alert |
| `crew-status.ts` | Live crew member status |
| `admin-bulk.ts` | Bulk admin operations (mass email, data export) |
| `health-core.ts` | Health checks (DB, Redis, disk), readiness probe |
| `calendar-sync.ts` | ICS calendar feed generation and sync |
| `pages.ts` | Static pages, password reset forms, SPA catch-all |
| `spotify.ts` | Spotify artist search and metadata |
| `expenses.ts` | Crew expense tracking and splitting |
| `client-metrics.ts` | Client-side performance metrics ingestion |
| `weather.ts` | Festival venue weather forecasts |
| `ratings.ts` | Post-festival set ratings |
| `deep-links.ts` | Universal/deep link handlers (mobile app) |
| `admin-audit.ts` | Audit log viewer |
| `health.ts` | Legacy health endpoint (delegates to health-core) |
| `analytics-install.ts` | Install/first-launch analytics |
| `activity.ts` | Crew activity feed |
| `admin-siteplan.ts` | Festival site-plan image upload (admin) |
| `crew-checkin.ts` | Crew check-in |
| `crew-days.ts` | Crew day list and update |
| `crew-live-location.ts` | Live location relay for crew members |
| `crew-nudge.ts` | "Looking for you" nudge to a crew member |
| `festival-announcements.ts` | Festival announcements: admin create and delete, attendee list |
| `festival-discovery.ts` | Festival follows and "also picked" suggestions |
| `identities.ts` | Linked sign-in identities |
| `lineup-announce.ts` | Admin lineup announcement |
| `oauth.ts` | Google and Apple sign-in |
| `artists.ts` | Admin artist repository: match, create, edit, merge, verify, and the organizer suggestions an admin decides |
| `manage-artists.ts` | Organizer artist routes under `/api/v1/manage/artists`: visible artists only, create, direct edit or suggestion |
| `lineup-interest.ts` | Admin demand view of lineup interest counts |
| `time-releases.ts` | Admin "set times are out" release for one festival date |

---

## Frontend: `packages/web/`

React 19 SPA with file-based routing via TanStack Router. Built with Vite 8 and Tailwind CSS 4. Routes are lazy-loaded with skeleton fallbacks. Vite config uses manual chunk splitting for HTTP/2 cache optimization (react-core, router, data, ui-motion, icons, export-tools, telemetry).

### Routes (`packages/web/src/router.tsx`, views in `packages/web/src/routes/`)

`/timeline` redirects to `/grid`: the web app has one grid. The timeline grid component lives in `packages/web/src/components/features/`.

| Route | View |
|-------|------|
| `account.tsx` | User settings, avatar, notifications, sessions |
| `grid.tsx` | Grid/spreadsheet schedule view |
| `crew.tsx` | Crew management, member list |
| `wrap.tsx` | Post-festival wrap-up / recap |
| `picks.tsx` | Personal picks list with conflict detection |
| `festival-mode.tsx` | Festival day-of mode (current/next set) |
| `register.tsx` | User registration |
| `compare.tsx` | Side-by-side crew schedule comparison |
| `forgot-password.tsx` | Password reset flow |
| `cards.tsx` | Card-style schedule view |
| `login.tsx` | Login form |
| `admin.tsx` | Admin panel |
| `caught.tsx` | Checklist for marking sets as caught |
| `crew-plan.tsx` | Crew plan |
| `finish-signup.tsx` | Finish sign-in with Google or Apple (`/signup/finish`) |
| `friend-picks.tsx` | A friend's picks |
| `inbox.tsx` | Inbox |
| `map.tsx` | Festival map |
| `plan-snapshot.tsx` | Read-only plan page opened from a plan QR (`/p`) |
| `rate.tsx` | Rate sets |
| `reset-password.tsx` | Set a new password |
| `set.tsx` | Set detail (`/set/$setId`) |

### PWA

Workbox service worker for offline support. localStorage snapshots of festival and profile data are updated on every state change. The app has no chat, so no messages are cached. An offline queue replays eligible writes when connectivity is restored: join-by-code, crew meeting points, polls, packing, rides, expenses, home base, reminders, status, days, and caught marks. The full list is `OFFLINE_ELIGIBLE_PATTERNS` in `packages/shared/src/services/api.ts`. The queue is not web-only: see [Offline queue replay](#offline-queue-replay).

---

## Mobile: `packages/mobile/`

Expo SDK 58 app (React Native 0.88) with expo-router file-based routes in `packages/mobile/app/`. The app version is 1.6.0, and `runtimeVersion` uses the `appVersion` policy in `app.json`, so an OTA update only reaches builds with the same app version. Business logic lives in `@festie/shared`. The mobile package imports only its own dependencies or `@festie/shared`.

---

## Shared Package: `packages/shared/`

TypeScript package imported by the web and mobile apps via workspace aliases (`@festie/shared/stores`, `@festie/shared/types`, etc.).

### Stores (Zustand)

| Store | State |
|-------|-------|
| `festivalDataStore.ts` | Cached festival data (festivals, sets, stages, days, profiles) |
| `festivalUIStore.ts` | Selected day, active stages, search query |
| `festivalStore.ts` | Festival store entry point alongside the two stores above |
| `authStore.ts` | User session, tokens, login state |
| `crewStore.ts` | Crew membership, activity |
| `festivalModeStore.ts` | Day-of festival mode (current set tracking) |
| `uiStore.ts` | UI state (detail panel, connection status, offline mode, pending sync count) |
| `announcementStore.ts`, `followStore.ts`, `inboxStore.ts`, `liveLocationStore.ts`, `notificationPrefsStore.ts`, `offlineReadinessStore.ts`, `weatherStore.ts` | Feature stores. See `packages/shared/src/stores/` |

### Services

- `api.ts` -- HTTP client wrapping fetch with auth headers, error handling
- `socket.ts` -- Socket.IO client with auto-reconnect, event listeners that push into Zustand stores
- `offlineQueue.ts` -- queued offline mutations replayed on reconnect

### Hooks

About 48 React hooks in `packages/shared/src/hooks/` bridge Zustand stores and services to components. Examples: `useAuth`, `useFestival`, `useCrew`, `usePicks`, `useSocket`, `useOffline`. Realtime event routing lives in `packages/shared/src/realtime/`.

### Types

`domain.ts`, `api.ts`, `api.gen.ts` (generated), `socket-events.ts` -- TypeScript interfaces for the full domain model, API shapes, and Socket.IO event contracts.

---

## Database

PostgreSQL 16 with connection pooling (pg, min 2 / max 20). 94 SQL files in `migrations/`, numbered from `004_postgresql_baseline.sql` through `112_artists_merge_refs.sql` with gaps. The app applies them at boot and they follow an additive, idempotent convention.

Key tables: `users`, `user_sessions`, `festivals`, `festival_stages`, `festival_days`, `festival_sets`, `festival_profiles`, `crews`, `crew_members`, `crew_activity`, `crew_polls`, `crew_expenses`, `device_tokens`, `audit_log`, `user_roles`.

---

## Subsystem Map

Where to start reading when one of these features misbehaves.

### Expense settle-up

- `GET /crews/:crewId/expenses/settlement-plan` in `routes/expenses.ts` reads each member's balance in integer cents from `getBalancesCents` in `lib/db/stores/expenses.ts`.
- `simplifyDebts` in the same store is a pure greedy function. It matches the largest creditor with the largest debtor, so N members need at most N-1 transfers. It ignores any transfer of 1 cent or less.
- The route adds only the payee's payment handles to each transfer.
- A recorded payment is an expense with category `settlement`. `packages/shared/src/utils/money.ts` (`isSettlement`, `spendingExpenses`) keeps it out of spending totals.
- `packages/shared/src/utils/expenseSplit.ts` builds shares on the client in cents, with the same rounding as the server ledger.

### Lineup import

- Clients parse CSV, TSV or pasted names (`packages/shared/src/utils/lineupPaste.ts` and the lineup import utils) and post JSON rows. The server never sees the file.
- `routes/lineup-import.ts` has a preview route and a commit route. Both call `planLineupImport` in `lib/lineup-import-plan.ts`, a pure planner. Commit runs it again inside the write transaction (`lib/db/stores/lineup-imports.ts`), so the write matches the locked festival.
- Imports never delete. A field a row leaves out is untouched, and an empty string in a mapped field clears the value.
- A row with names but no day, stage or time is an announced row. It goes into `festivals.lineup`, whose key and cover rules live in `lib/lineup.ts`.
- Each commit is recorded, and the history route can undo it.
- Admin screens: `packages/web/src/components/admin/LineupImport.tsx` and `packages/mobile/app/admin/lineup-import.tsx`, both calling `lineupImportApi` from `@festie/shared`.

### Announcement delivery

- An admin creates an announcement through `routes/festival-announcements.ts`. The row waits in `festival_announcements` until its `sendAt`.
- `deliverDue()` in `lib/announcements.ts` expires late rows, claims due rows and pushes each one to everyone who joined the festival. `claimDue` uses SKIP LOCKED, so a row goes out once. An announcement for a deleted or unpublished (draft) festival is claimed but sent to nobody, and gets recipient count 0.
- Two callers run it: the 60-second sweep in `lib/background-tasks.ts` and the create route, for a send-now announcement.
- If a push never arrives, check the `announcements` job run metric, then the delivery log lines.

### Offline queue replay

- Web queues writes in `window.__festieQueue`. Mobile and any host without it use `packages/shared/src/services/offlineQueue.ts`, which persists to the storage adapter that `packages/mobile/bootstrap.ts` configures (AsyncStorage).
- Replay is oldest-first. `drainQueue` runs from `packages/mobile/components/OfflineBanner.tsx` on a NetInfo change, on app foreground, and on a backoff timer while writes stay pending. `markOnlineAndDrain` in `packages/shared/src/services/api.ts` also drains it when a successful request shows the app is back online.
- Entries older than 24 hours are dropped. A transient failure retries up to 5 times. A permanent 4xx moves the entry to `uiStore.failedSync` for the user to retry or dismiss.
- SOS routes are never queued. They are online-only (see the comment in `api.ts`).

### Set status

- `getSetStatus` in `packages/shared/src/utils/setStatus.ts` returns `tba`, `live`, `soon` (30 minutes or less), `upcoming` (up to 2 hours), `later` or `past`. It is pure: the caller passes `now`.
- A start before 06:00 belongs to the previous festival day, and `getSetTimeBounds` handles the rollover. With a festival time zone, bounds are absolute epoch milliseconds, so `now` must be a real `Date`.
- Web and mobile consume it through `useSetStatus` (`packages/web/src/hooks/useSetStatus.ts`, `packages/mobile/hooks/useSetStatus.ts`). Fix wrong live or past badges in the shared function, not in the hooks.

---

## Key Design Patterns

For existing helpers, components and queries by task, see [`docs/REUSE.md`](./docs/REUSE.md).

### Dependency Injection via Factory Functions

The central architectural pattern. Every route module exports a factory that receives the full `deps` object (pool, redis, config, io, log, stores, schemas, helpers, etc.) and returns an Express Router. This makes routes testable with swapped dependencies and keeps the dependency graph explicit.

### Multi-Tier Rate Limiting

- **In-memory** (single process): per-IP API limit, per-IP auth limit, per-userId auth limit
- **Redis-backed**: counters live in Redis when it is reachable, so they survive a restart
- **Graceful fallback**: if Redis is unavailable, falls back to in-memory with logged warning
- In-memory maps are capped at 10,000 entries and drop the oldest entry first

### Session Security

- Scrypt password hashing (64-byte derived key, random 16-byte salt). Google and Apple sign-in are also supported
- SHA-256 hashed session tokens (32 bytes random, never stored in plaintext)
- Session rows live in Postgres (`user_sessions`), with a 24-hour TTL (`SESSION_TTL`)
- HTTP-only cookies. `COOKIE_SAME_SITE` defaults to `lax`, and `COOKIE_SECURE` is configurable
- At most `USER_SESSION_MAX` (default 10) concurrent sessions per user; a new login evicts the least recently used
- Evicted sessions immediately disconnected via Socket.IO

### Real-Time (Socket.IO)

- Festival rooms for scoped broadcasts
- Presence tracking with debounced updates (200ms)
- Redis adapter for pub/sub across processes
- Push notifications (FCM, APNs, Web Push) with DND support

### API Response Format

```ts
// Success
{ ok: true, ...data }

// Error
{ ok: false, code: 'ERROR_CODE', message: '...' }
```

API docs available at `/api/docs` (Swagger UI), generated by `lib/openapi.ts`.

---

## Runtime

- **Single process.** The server runs as one Node process. `npm run build` (`scripts/build.mjs`, esbuild) creates `dist/` and the worker bundles. `dist/` is gitignored, so it is built on each target.
- **Cluster mode stays off.** `lib/email.ts` send idempotency and two limiters in `routes/email-auth.ts` hold per-process state.
- **Redis 7** serves rate limits, the Socket.IO adapter, presence, the live-location cache, and the cache invalidation bus.
- **Docker**: multi-stage build, Node 22.22.1 slim, non-root user, health check at `/api/ready`. The image starts the source with `tsx` (`node --import tsx/esm server.ts`).
- Deployment and operations are run privately and are not documented in this repository.

### Environment Variables

In production the server refuses to start without `PUBLIC_ORIGIN`, `DATABASE_URL` and `SESSION_SECRET`. It also needs `WEBHOOK_TOKEN_HMAC_KEY` when `FCM_RETRY_WEBHOOK_URL` is set, and `EMAIL_FROM` must use a festie.us address when set. `FIREBASE_CREDENTIALS_PATH` (push) and `RESEND_API_KEY` (email) default to empty. `REDIS_URL` defaults to `redis://127.0.0.1:6379`. All are read through `lib/config.ts`.

---

## Testing

Tests use Node's built-in test runner (`node:test` + `node:assert`). 258 backend test files in `tests/*.test.ts` covering:

- Unit tests (`tests/unit.test.ts`)
- Integration tests (`tests/integration-*.test.ts`) -- auth, festivals, picks, crews, notifications, admin, export, sockets
- Critical path tests (`tests/critical-paths.test.ts`) -- end-to-end user journeys
- Hardening tests (`tests/hardening.test.ts`) -- security, rate limits, session edge cases
- Feature tests -- email-auth, crew-features, lineup-import, share, profiles, ratings, notifications
- E2E tests (`tests/e2e/*.spec.ts`, 7 specs) -- Playwright browser automation
- Web, shared and mobile packages use vitest (`pnpm --filter <package> test`)

```bash
npm test              # All backend tests (sequential)
npm run test:unit     # Unit tests only
npm run test:e2e      # Playwright E2E
npm run test:coverage # c8 coverage report
```
