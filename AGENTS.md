# AGENTS.md

Project conventions and orientation for engineers and coding agents working in this repo.
This file is tool-neutral.
For deeper detail see [`ARCHITECTURE.md`](./ARCHITECTURE.md); local dev setup lives in
[`GETTING_STARTED.md`](./GETTING_STARTED.md). (Festie is proprietary — see [`LICENSE`](./LICENSE);
production credentials and deployment operations stay private and outside this repository.)

## What this is

Festie — a real-time festival crew-coordination app. Live at [festie.us](https://festie.us).

## Monorepo layout

- **`/` (root)** — Express 5 + TypeScript backend, entry `server.ts`. `npm run dev` and
  `npm start` run it directly with `tsx`; production runs the esbuild bundle `dist/server.js`
  (`npm run build`, see `scripts/build.mjs`). PostgreSQL 16, Redis 7, Socket.IO 4.
  **Root installs with `npm`.**
- **`packages/web`** — React 19 + Vite + TanStack Router + Tailwind 4 SPA.
- **`packages/mobile`** — Expo SDK 58 + expo-router (React Native).
- **`packages/shared`** — `@festie/shared`: zustand stores, hooks, services, types, utils
  consumed by both web and mobile. **The `packages/` workspace installs with `pnpm`.**

## Commands

| Scope | Command |
|-------|---------|
| Backend dev / start | `npm run dev` / `npm start` |
| Backend tests / lint / typecheck | `npm test` / `npm run lint` / `npm run typecheck` |
| Web | `pnpm --filter @festie/web {dev,build,test,lint,typecheck}` |
| Shared | `pnpm --filter @festie/shared {test,lint,typecheck}` |
| Mobile | `pnpm --filter @festie/mobile {typecheck,lint,test}` |
| Repo checks | `npm run check:design`, `check:docs`, `check:legal`, `check:migrations`, `check:ground`, `check:brand-rasters`, `gen:api-types:check` |

## Conventions & guardrails

- **Do NOT add a `packageManager` field to the root `package.json`.** The root is an npm project;
  only `packages/` is a pnpm workspace (see the orphaned-root-lock note in `.gitignore`). Adding
  it re-points the root at pnpm and breaks installs/CI.
- **Mobile may only import from its own declared deps or `@festie/shared`** — never from shared's
  transitive deps (e.g. `socket.io-client`); import shared types via `@festie/shared/...` instead,
  or CI mobile-typecheck fails with `TS2307`.
- Before you write a new helper, component or query, check `docs/REUSE.md`.
- **Business logic lives in `@festie/shared`** so web and mobile stay in parity; prefer adding to
  shared over duplicating per-app.
- **Never commit secrets.** `tests/e2e/.auth/` holds a live session cookie and is gitignored —
  keep it that way.
- Validate all API inputs with the Zod schemas in `lib/schemas.ts`.
- CI must stay green: backend tests + web/shared vitest + mobile typecheck + lint + quality.

## Branches

Production tracks the `main` branch, and `main` is now the only long-lived branch — the former
`master` line was deleted upstream, so day-to-day work branches off `main` and returns by PR.
Operational and deployment detail is kept private and is not documented in this repository.
