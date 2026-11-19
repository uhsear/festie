# Architecture decision records

An ADR records one decision, the reasons for it, and its consequences. Code comments explain a line. An ADR explains why the design is shaped that way.

## When to write one

Write an ADR when a decision is hard to reverse or when a new contributor would ask "why is it done this way?". Infrastructure, data-model and cross-package decisions qualify. Feature decisions qualify when they set a rule that code must keep, such as set-status semantics or offline-queue idempotency.

## How to add one

1. Copy `template.md` to `NNN-short-title.md`. Use the next unused number.
2. Fill in every section. Keep the ADR under two pages.
3. Add a row to the index below.
4. Never rewrite an accepted ADR. To change a decision, write a new ADR and mark the old one `Superseded by ADR-NNN`.

`npm run check:docs` verifies that every repo path cited in an ADR exists.

## Statuses

- **Proposed**: under discussion.
- **Accepted**: in force.
- **Superseded by ADR-NNN**: replaced. Keep it as history.

## Index

ADRs 001 to 003 were never written. Numbering starts at 004. Only this README and the template are published in this repository. The ADR files listed here are kept in the maintainers' checkout.

| ADR | Decision | Status |
|-----|----------|--------|
| 004 | CSRF protection and bearer token design | Accepted |
| 005 | Migrate the backend to TypeScript | Accepted |
| 006 | Monorepo with npm at the root and pnpm in packages | Accepted |
| 007 | tsx no-build runtime in production | Superseded by ADR-016 |
| 008 | App-managed migrations applied on boot through a version ledger | Accepted |
| 009 | Dependency injection through route factory functions | Accepted |
| 010 | Shared business-logic package consumed by web and mobile | Accepted |
| 011 | Multi-tier rate limiting with Redis and an in-memory fallback | Accepted |
| 012 | Socket.IO with the Redis adapter for multi-worker broadcasting | Accepted |
| 013 | scrypt and SHA-256 session-token authentication, no JWTs | Accepted |
| 014 | Single-host process manager and tunnel deployment | Accepted |
| 015 | Expo and EAS for cross-platform mobile | Accepted |
| 016 | esbuild bundle as the production backend runtime | Accepted |
