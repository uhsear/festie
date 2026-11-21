# Festie — Developer Getting Started Guide

*Intended audience: engineers setting up the Festie codebase for the first time.*

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Repo layout](#2-repo-layout)
3. [Clone and install](#3-clone-and-install)
4. [Environment variables](#4-environment-variables)
5. [Running in development](#5-running-in-development)
6. [Running the test suites](#6-running-the-test-suites)
7. [Building for production](#7-building-for-production)
8. [Deploying](#8-deploying)
9. [CI overview](#9-ci-overview)
10. [First-day checklist](#10-first-day-checklist)
11. [Known blockers and caveats](#11-known-blockers-and-caveats)

---

## 1. Prerequisites

| Tool | Required version | Notes |
|------|-----------------|-------|
| **Node.js** | `>=22.0.0` (pin to `22` via `.nvmrc`) | Engine constraint in `package.json`; Docker image uses `22.22.1-slim` |
| **npm** | bundled with Node 22 | Root workspace uses npm — do **not** install pnpm at the root |
| **pnpm** | `9.x` (E2E/mobile workflows) or `10.x` (security-audit workflow) | Only manages `packages/` workspace; CI pins version per workflow |
| **PostgreSQL** | `16` | pg 16-alpine in CI; CI runs pg 16 |
| **Redis** | `7` | redis:7-alpine in CI; falls back to in-memory rate limiting when `REDIS_ENABLED=false` |
| **Docker** (optional) | any recent version | Required only for containerised runs or the test-db helper scripts |

**Node version management.** The repo ships `.nvmrc` containing `22`. Run `nvm use` (or equivalent) before any install step.

---

## 2. Repo layout

```
festie/
├── server.ts              # Express 5 entry point — run via tsx in dev, bundled with esbuild for production
├── lib/                   # Backend library modules (config, DB, Redis, middleware, …)
├── routes/                # Express route factory modules
├── migrations/            # PostgreSQL migration files (004 baseline → current), all idempotent
├── tests/                 # Backend test suite (node:test runner)
│   └── e2e/               # Playwright browser tests
├── public/                # Static assets served by Express
├── scripts/               # Operational and tooling scripts
├── Dockerfile             # Multi-stage Node 22 image
├── package.json           # ROOT — npm project, engines: node >=22
├── packages/
│   ├── web/               # @festie/web — React 19 + Vite + TanStack Router SPA
│   ├── mobile/            # @festie/mobile — Expo SDK 58 + expo-router (React Native)
│   └── shared/            # @festie/shared — Zustand stores, hooks, services, types, utils
├── packages/package.json  # pnpm workspace root (packages/ only)
└── packages/.npmrc        # pnpm hoisting rules for Expo config-plugins + eslint/prettier
```

**Critical split:** the repo root is an **npm** project; `packages/` is a **pnpm** workspace. These must not be mixed. Do **not** add a `packageManager` field to the root `package.json` — this would break CI installs by redirecting npm to pnpm.

---

## 3. Clone and install

```bash
# 1. Clone
git clone https://github.com/uhsear/festie.git festie
cd festie

# 2. Select Node 22
nvm use      # reads .nvmrc → 22

# 3. Install root (backend) dependencies
npm ci

# 4. Install packages/ workspace (web + mobile + shared)
cd packages
pnpm install --frozen-lockfile
cd ..

# 5. Fetch the licensed display fonts (needs read access to uhsear/festie-fonts)
node scripts/fetch-fonts.mjs
```

> The Clash Display font files are not in this repository. Their licence (ITF Free Font License) does not allow distribution through a public repository, so they live in the private repo `uhsear/festie-fonts`. The web build fetches them when it can and otherwise falls back to the system font. A mobile bundle fails without them.

> Root `.npmrc` sets `ignore-scripts=true`. Native modules that need a post-install build step (e.g. `sharp`) are installed by the Dockerfile using `npm ci --omit=dev` inside the build image, where build tools (`make`, `g++`, `libvips42`) are available. Locally on macOS/Linux `npm ci` should work without extra tooling; on Windows you may need `windows-build-tools` or WSL2 for `sharp`.

### Workspace aliases

`packages/shared` is consumed by both web and mobile via workspace aliases (`@festie/shared/stores`, `@festie/shared/types`, etc.) declared in `packages/shared/package.json` exports. These resolve automatically under pnpm's workspace setup — no build step is needed for the shared package in development.

---

## 4. Environment variables

The backend reads all env vars through `lib/config.ts`. Create a `.env` file in the repo root (never commit it). Copy `.env.example` from the repo root and fill in the values described below.

### Required (server will not start in production without these)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/festie` |
| `PUBLIC_ORIGIN` | Canonical origin of the deployed app, e.g. `https://festie.us` (required in production; startup validator enforces it) |
| `SESSION_SECRET` | Strong random string; reserved for future HMAC session signing, enforced at startup in production |

### Required for integration tests

| Variable | Purpose |
|----------|---------|
| `TEST_DATABASE_URL` | Must include `_test` in the DB name, e.g. `postgresql://user:pass@localhost:5432/festie_test`. Set it before `npm test`: most DB-backed suites fail at import without it (details under "Without `TEST_DATABASE_URL`" below). CI always sets it. |

### Optional but commonly needed

| Variable | Default | Purpose |
|----------|---------|---------|
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection. Falls back to in-memory when unset or `REDIS_ENABLED=false` |
| `REDIS_ENABLED` | `true` | Set `false` to run without Redis locally |
| `RESEND_API_KEY` | — | Transactional email (password reset, invites). Email features silently disabled when unset. |
| `FIREBASE_CREDENTIALS_PATH` | — | Absolute path to the Firebase service-account JSON file. Set it to enable FCM push notifications. The server starts normally when it is unset, and push delivery stays disabled. |
| `ALLOWED_ORIGINS` | derived from `PUBLIC_ORIGIN` | Comma-separated extra CORS origins |
| `PORT` | `4000` | HTTP port the backend listens on |
| `BIND_ADDRESS` | `127.0.0.1` | Interface to bind; set `0.0.0.0` in Docker |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Pino log level |
| `SENTRY_DSN` | — | Sentry error reporting (optional) |

### Optional external integrations

| Variable | Purpose |
|----------|---------|
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify artist metadata for lineup import; feature disabled when unset |
| `APNS_KEY_PATH` / `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_BUNDLE_ID` | Direct APNs push for iOS tokens; APNs sender disabled when any of these are unset |
| `APPLE_TEAM_ID` / `ANDROID_CERT_FINGERPRINTS` | Universal/deep-link asset endpoints |
| `WEBHOOK_TOKEN_HMAC_KEY` | Required when `FCM_RETRY_WEBHOOK_URL` is set; startup validator enforces this pairing |
| `FCM_RETRY_WEBHOOK_URL` | FCM retry webhook endpoint |
| `MOBILE_ORIGINS` | Comma-separated TWA / custom-scheme origins for mobile CORS |
| `TILES_DIR` | Absolute path to a directory of `.pmtiles` files. The server then serves them at `/tiles/<name>.pmtiles` with Range support. File names use `a-z`, `0-9`, `_` and `-`. Unset turns the feature off, and the route answers 404. See `scripts/maps/extract-pmtiles.md`. |

### Development minimum `.env`

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/festie
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/festie_test
SESSION_SECRET=replace-with-32+-random-chars
PUBLIC_ORIGIN=http://localhost:4000
REDIS_ENABLED=false
NODE_ENV=development
```

---

## 5. Running in development

### Backend

```bash
# From repo root
npm run dev
```

This runs `node --import tsx/esm server.ts` directly. There is **no compile step** — tsx transpiles TypeScript on the fly via esbuild. The server starts on port 4000 by default.

On first run with a fresh database, `lib/planner-db-pg.ts` auto-applies all migrations in `migrations/` order.

Health endpoints:
- `GET /api/health` — liveness
- `GET /api/ready` — readiness (checks DB + Redis connectivity)
- `GET /api/docs` — Swagger UI (OpenAPI 3.0 spec generated from route metadata)

### Web frontend

```bash
pnpm --filter @festie/web dev
```

Vite dev server starts (default port 5173). It expects the backend to be running at `http://localhost:4000` for API calls. The SPA uses TanStack Router with file-based routing under `packages/web/src/routes/`.

### Mobile (Expo)

```bash
pnpm --filter @festie/mobile start
```

Requires Expo CLI. Use Expo Go or a dev build (`expo-dev-client`) on a physical device or emulator. See `packages/mobile/package.json` for `android`, `ios`, and `web` sub-commands.

> **Import constraint:** Mobile code may only import from its own declared dependencies or `@festie/shared`. Never import shared's transitive dependencies directly (e.g. `socket.io-client`) — use `@festie/shared/...` sub-path imports instead, or CI mobile typecheck will fail with `TS2307`.

---

## 6. Running the test suites

### Backend tests (node:test runner)

```bash
# All backend tests — sequential, requires TEST_DATABASE_URL
npm test

# Unit tests only — no database required
npm run test:unit

# Coverage report (c8) — enforces 87% lines/statements, 80% branches, 89% functions
npm run test:coverage
```

**Test database setup** (one-time, for integration tests):

```bash
# Option A: use Docker (recommended for isolation)
npm run test:db:up       # spins up postgres:16-alpine on port 5433
npm run test:db:migrate  # applies all migrations to festie_test DB
# ... run tests ...
npm run test:db:down     # tears down the container

# Option B: use your local Postgres
createdb festie_test
# Then set TEST_DATABASE_URL in .env — migrations are applied automatically by _integration-helpers.ts
```

CI sets `TEST_DATABASE_URL=postgresql://test_user:test_password@localhost:5432/festie_test` with a Postgres 16 service container.

**Without `TEST_DATABASE_URL`:** suites that import `skip` from `tests/_test-schema.ts` skip themselves. Suites that import `tests/_integration-helpers.ts` (or call `requireTestDatabaseUrl()`) print `ERROR: TEST_DATABASE_URL env var required` and exit 1. With no `DATABASE_URL` either, suites fail at import with `loadConfig: refusing the implicit ... fallback`, because the config refuses to guess a database. So `npm test` fails with no database configured. Set both `TEST_DATABASE_URL` and `DATABASE_URL` to the same `_test` database.
```ts
import { skip } from './_test-schema';
describe('feature', { skip }, () => { ... });
```

### Frontend / shared tests (vitest)

```bash
# Shared package tests
pnpm --filter @festie/shared test

# Web tests
pnpm --filter @festie/web test

# With coverage
pnpm --filter @festie/web test:coverage
```

### Mobile typecheck, lint and tests

```bash
pnpm --filter @festie/mobile typecheck
pnpm --filter @festie/mobile lint
pnpm --filter @festie/mobile test
```

The mobile vitest suite covers the mobile-only code. Shared logic is tested in `@festie/shared`.

### Backend typecheck and lint

```bash
npm run typecheck   # tsc --noEmit (root tsconfig)
npm run lint        # eslint lib/ routes/ server.ts
```

### E2E tests (Playwright)

```bash
# Full E2E suite (requires a running backend + real DB)
npm run test:e2e

# Deterministic local suite (requires a disposable DB named festie_test)
TEST_DATABASE_URL=postgresql://user:pass@localhost:5433/festie_test \
  npx playwright test --project=chromium \
  tests/e2e/festival-planner.spec.ts tests/e2e/accessibility.spec.ts \
  tests/e2e/reduced-motion.spec.ts tests/e2e/responsive-design.spec.ts

# Visual regression baselines (committed snapshots required)
npm run test:visual
npm run test:visual:update   # regenerate baseline snapshots
```

E2E fixtures ignore `DATABASE_URL` and refuse to start unless `TEST_DATABASE_URL`
names a database exactly `festie_test`. Tests seed that disposable database and
never use production credentials. Nightly CI runs functional, axe, and reduced-motion
coverage in Chromium, Firefox, and WebKit, then gates reviewed responsive screenshots
in Chromium. A manual `update_snapshots` workflow run uploads Linux baseline candidates
for review; scheduled runs always compare and fail on drift.

Visual regression snapshots in `tests/__snapshots__/` cover 6 device profiles (iphone-se, iphone-14, pixel-7, ipad, laptop, desktop). Updating these requires intentional review — run `npm run test:visual:update` only when UI changes are intentional.

---

## 7. Building for production

### Backend

Local dev has no build step: `npm run dev` and `npm start` run `server.ts` through tsx.
Production runs an esbuild bundle instead:

```bash
npm run build   # scripts/build.mjs writes dist/server.js and the worker entrypoints
```

Production runs `dist/server.js` with plain `node` as a single process. `dist/` is gitignored, so it is built on each target.

### Docker

```bash
docker build -t festie .
docker run -p 4000:4000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/festie \
  -e SESSION_SECRET=your-secret-here \
  -e PUBLIC_ORIGIN=https://festie.us \
  festie
```

The Dockerfile is a multi-stage build:
1. Build stage: `node:22.22.1-slim` + `make g++` (for `sharp` native compilation)
2. Production stage: `node:22.22.1-slim` + `libvips42` runtime; non-root user `app:app`
3. Copies: `package.json tsconfig.json server.ts lib/ routes/ migrations/ public/ scripts/`
4. Runs `npm ci --omit=dev` to install production deps only
5. Exposes port `4000`, healthcheck hits `/api/ready`

> The `public/uploads/avatars/` directory is created at image build time. In production, avatars are served from the filesystem — there is no CDN upload step configured in the image.

### Web frontend

```bash
pnpm --filter @festie/web build
```

Output lands in `packages/web/dist/`. The Express backend serves this directory as the SPA catch-all in production (`routes/pages.ts`). Vite is configured with manual chunk splitting for HTTP/2 cache optimization.

### Mobile (EAS / native)

Mobile builds are managed via Expo Application Services (EAS). See `packages/mobile/eas.json` and the GitHub Actions workflows `android-release.yml` / `ios-e2e.yml` for build commands. OTA (over-the-air) JS updates are pushed via the `mobile-ota.yml` workflow without a full native build.

---

## 8. Deploying

Deployment is operated privately and is not documented in this repository.

---

## 9. CI overview

All workflows in `.github/workflows/`:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | push/PR to `main` | Lint, typecheck, backend tests (with coverage gate), frontend vitest, mobile typecheck, security audit, Lighthouse, bundle-size, Docker build |
| `security-audit.yml` | daily 06:00 UTC | `npm audit` + `pnpm audit` at `--audit-level=high`; blocking |
| `e2e-web.yml` | nightly 07:30 UTC | Playwright chromium E2E against a real Postgres+Redis stack |
| `uptime.yml` | every 10 minutes | Off-host reachability check; auto-opens/closes GitHub issue on failure. Liveness and auto-restart live in `scripts/health-check.sh`; error rate, memory, disk and `/api/ready` in `scripts/error-rate-alert.cjs` |
| `mobile-ota.yml` | manual dispatch | EAS OTA update (`eas update`) to a channel; crash-rate gate |
| `mobile-release-gate.yml` | manual dispatch | Pre-build gate: expo-doctor, fingerprint diff, typecheck, lint |
| `android-release.yml` | manual dispatch | Gradle AAB build + optional Play Store internal-track submit |
| `android-e2e.yml` | manual dispatch | Android emulator + Maestro smoke tests (~25 min) |
| `ios-e2e.yml` | manual dispatch | iOS simulator + Maestro smoke tests, macOS 15 runner (~20 min) |

**CI coverage gate** (`ci.yml` `test` job): `--lines 87 --branches 80 --functions 89 --statements 87`. The `c8` config is in `config/c8rc.json`.

**Secrets required by CI:**
- `TEST_USERNAME` / `TEST_PASSWORD` — used by E2E and Maestro flows
- `EXPO_TOKEN` — EAS authentication
- `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` — Android signing
- `SENTRY_AUTH_TOKEN` — Sentry source map upload
- `PLAY_SERVICE_ACCOUNT_JSON` — Google Play submission

---

## 10. First-day checklist

- [ ] Install Node 22 (`nvm use` picks it up from `.nvmrc`)
- [ ] `npm ci` at repo root (backend deps)
- [ ] `cd packages && pnpm install --frozen-lockfile` (web/mobile/shared deps)
- [ ] Copy `.env.example` to `.env`, fill in `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_ORIGIN`
- [ ] Create local Postgres 16 database (`createdb festie`)
- [ ] Start backend: `npm run dev` — verify `GET /api/ready` returns `{"ok":true,"data":{"status":"ready"}}`
- [ ] Start web: `pnpm --filter @festie/web dev` — app loads at `http://localhost:5173`
- [ ] Create test DB and run backend tests: `npm run test:db:up && npm run test:db:migrate && npm test && npm run test:db:down`
- [ ] Run frontend tests: `pnpm --filter @festie/shared test && pnpm --filter @festie/web test`
- [ ] Run mobile typecheck: `pnpm --filter @festie/mobile typecheck`
- [ ] Run lint across all packages: `npm run lint && pnpm --filter @festie/web lint && pnpm --filter @festie/mobile lint`
- [ ] Review `ARCHITECTURE.md` for architectural overview
- [ ] Review `lib/config.ts` for the full env-var reference with defaults

---

## 11. Known blockers and caveats

### E2E tests require a disposable database

Browser fixtures truncate and reseed `festie_test` for deterministic runs. Set
`TEST_DATABASE_URL` explicitly; `DATABASE_URL` is ignored and any other database
name is rejected before a connection is opened.

### Windows local development

`scripts/test:db:migrate` in `package.json` uses a bash `for` loop. On Windows, run it inside WSL2, Git Bash, or use the Docker approach (`npm run test:db:up`).

`sharp` (image processing for avatars) requires native binaries. Windows users should build inside WSL2 or Docker to avoid native-module compile issues.

### Single process, no cluster mode

The backend runs as one process. Per-process state in `lib/email.ts` send idempotency and two limiters in `routes/email-auth.ts` blocks cluster mode. Compiling to JavaScript does not remove that blocker.

### Mobile import constraint

Any file under `packages/mobile/` that imports from `socket.io-client` directly (instead of via `@festie/shared`) will cause CI to fail with `TS2307`. Always import through the shared package's exported sub-paths.

### pnpm version mismatch across workflows

`e2e-web.yml`, `mobile-ota.yml`, and the mobile/Android workflows pin pnpm `9`; `security-audit.yml` uses pnpm `10`. When installing locally, either version works for `packages/` — but be aware the lockfile was generated with pnpm 9.

### Firebase credentials

`FIREBASE_CREDENTIALS_PATH` must point to a real Firebase service-account JSON file for push notifications to work. Without it the server starts fine but FCM push delivery is silently disabled.
