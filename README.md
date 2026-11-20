# Festie

Festival crew coordination. Live at [festie.us](https://festie.us), on iOS and on Android.

This repository is published for transparency. Festie is proprietary software: see [LICENSE](./LICENSE). No licence to use, copy, modify or distribute the code is granted.

To report a security issue, see [SECURITY.md](./SECURITY.md).

Docs: [ARCHITECTURE.md](./ARCHITECTURE.md), [CONTEXT.md](./CONTEXT.md) (domain glossary), [AGENTS.md](./AGENTS.md), [GETTING_STARTED.md](./GETTING_STARTED.md), [CONTRIBUTING.md](./CONTRIBUTING.md).

Install order: run `npm ci` at the root, then `pnpm install --frozen-lockfile` in `packages/`. Root `npm run typecheck` also checks `packages/shared` files that import `papaparse`, so it fails with TS2307 until the `packages/` install has run. See [GETTING_STARTED.md](./GETTING_STARTED.md).
