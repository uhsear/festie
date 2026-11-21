# Secret handling

This repository is public. Nothing in it may be a credential, and nothing in it may describe the
private infrastructure behind festie.us.

## Where secrets live

- Server secrets live in the server's environment file and in the process manager's environment. They never enter git.
- CI secrets live in GitHub Actions repository secrets. Workflows read them as `${{ secrets.NAME }}`.
- Mobile build tokens and signing material live in the EAS account, not in the checkout.
- Local development uses an untracked environment file copied from `.env.example`. Keep only placeholder values in `.env.example`.
- Test code uses fake values built for the test. A fixture must not look like a live credential.

## What is never committed

Private keys, certificates, keystores, service-account files, saved browser sessions, environment
files other than `.env.example`, real tokens, database URIs with real passwords, private IP addresses,
absolute paths on a developer or server machine, and the production database name. `.gitignore`
blocks the common file names. The checks below block the rest.

## What the guards do

1. **Pre-commit (`scripts/ci/scan-staged-secrets.mjs`, run by lint-staged).** It reads the staged diff.
   It rejects secret-shaped added lines (cloud, GitHub, Slack, Stripe, Sentry and Expo tokens,
   JWTs, database URIs with a password, private key headers) and the hygiene shapes listed below.
   It also rejects staged file names that mark secret material. It prints the file, the line and the
   kind of finding. It never prints the matched text.
2. **CI `secrets` job.** It fetches the full history and runs gitleaks, pinned to one version, over
   the whole push or pull-request range. It then runs `scripts/ci/check-public-text.mjs` over the
   added lines and the commit messages. Either step fails the job. The job name `secrets` is a
   required status check, so keep the name.
3. **GitHub secret scanning and push protection.** Both are enabled on the public repository.
   Push protection rejects a push that contains a known provider token.

The hygiene shapes are: private network addresses, private key headers, home-directory server paths,
absolute Windows user paths, private project paths, and the bare production database name. The
staging and test database names are allowed.

## Allowing a false positive

Fix the value first. If the line is a deliberate fixture or a documented example, end it with a
comment:

```
secret-scan: allow <reason>
```

Write a real reason. A reviewer reads it. For a gitleaks finding on a test fixture, add a narrow
entry to `.gitleaks.toml` or `.gitleaksignore` instead of a broad path rule. Never allowlist a value
that works against a live system.

## If a secret leaks

1. **Treat the value as compromised.** Do this before you clean up. Deleting a commit does not
   unpublish a value that anyone may have already read.
2. **Rotate it at the source.** Issue a new credential, deploy it, then revoke the old one.
3. **Find out where it went.** Check every branch, tag and pull-request ref. Check forks and any
   cached views. Search the history by the value's shape, not only by file name.
4. **Remove it from reachable history only if rotation is not enough.** A history rewrite needs the
   owner's approval and a request to GitHub support to drop cached views. Do not force-push on your own.
5. **Record the incident.** Note what leaked, when, how it was found, and when it was rotated.
6. **Close the gap.** Add a pattern or an ignore rule so the same shape is caught next time.

## Reporting

Report a suspected leak privately through the contact in `SECURITY.md`. Do not open a public issue
that contains the value.
