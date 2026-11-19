# Running the tests locally

## Backend tests

`npm test` runs every `tests/*.test.ts` file. Most files are integration tests that need Postgres.
When `TEST_DATABASE_URL` is unset, `tests/_integration-helpers.ts` prints an error and exits with code 1.
The suites are not skipped. The database name must contain `_test`.

1. Start the test database: `npm run test:db:up`. It runs `postgres:16-alpine` on host port 5433.
   The script calls Node, so it also works from Windows `cmd.exe` and PowerShell.
2. Apply the migrations: `npm run test:db:migrate`. This needs `bash` and `psql` on your PATH.
   If you have no local `psql`, pipe each file through `docker exec -i festie-test-db psql -U festie -d festie_test`.
3. Set the connection strings, then run the tests. Tests refuse to start without `DATABASE_URL`.

```
export TEST_DATABASE_URL=postgres://festie:festie@localhost:5433/festie_test
export DATABASE_URL=$TEST_DATABASE_URL
npm test
```

Stop the database with `npm run test:db:down`.

CI uses a different convention: a Postgres service on port 5432 with the user `test_user`.
The local container uses port 5433 and the user `festie`. Both use the database `festie_test`.
Never point `TEST_DATABASE_URL` at a production database.

## End-to-end tests

The e2e suite needs the same database and environment variables, with migrations applied, plus three more steps.

1. Build the web app: `pnpm --dir packages install --frozen-lockfile`, then `pnpm --dir packages --filter @festie/web build`.
   Without the build, the server serves a stub page and the tests fail.
2. Install the browser: `npx playwright install chromium`.
3. Run `npx playwright test --project=chromium --grep-invert screenshot`.

The visual-regression specs compare against Linux baselines from CI. They fail on other platforms, so leave them to CI.
Locally, 40 specs pass and the 12 `visual-regression*` cases fail.

## Mobile tests

`pnpm --dir packages --filter @festie/mobile test` runs the mobile suite with vitest.
