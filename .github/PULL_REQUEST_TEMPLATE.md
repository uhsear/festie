## Summary

<!-- What does this PR do? -->

## Changes

<!-- List key changes -->

## Testing

- [ ] All tests pass (`npm test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Typecheck passes (`npm run typecheck`, plus `pnpm --filter @festie/web typecheck`, `pnpm --filter @festie/shared typecheck` and `pnpm --filter @festie/mobile typecheck` when those packages change)
- [ ] Web, shared and mobile tests pass when those packages change (`pnpm --filter <package> test`)
- [ ] Tested on mobile devices
- [ ] No console.log statements left in server code

## Checks

- [ ] If `lib/schemas.ts` changed, I ran `npm run gen:api-types` and committed the generated files
- [ ] If the database schema changed, the change is a new migration and I did not edit an applied one
- [ ] The diff has no secrets, server addresses, hostnames or private paths (`node scripts/ci/check-public-text.mjs` passes)

## Screenshots

<!-- If UI changes, add before/after screenshots -->
