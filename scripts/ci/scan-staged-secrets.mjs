#!/usr/bin/env node
// Pre-commit secret gate. Scans the lines ADDED in the staged diff for credential
// shapes and public-repo hygiene shapes (the same ones CI's check-public-text uses),
// and rejects staged files whose NAME marks them as secret material. Output names
// file, line and KIND only, never the matched text.
//
// Usage: node scripts/ci/scan-staged-secrets.mjs   (run by lint-staged)
// Exit:  0 clean, 1 finding, 2 git error.
// Allowlist: end a line with a comment `secret-scan: allow <reason>`.
//
// This is a fast first layer. CI runs gitleaks over the full PR range as the real gate.
// shortcut: reads the whole staged diff into memory, upgrade if commits outgrow it.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { addedLines, findKinds } from './check-public-text.mjs';

// Pieces are joined at runtime so this file never matches its own patterns.
const TOKEN = (prefix, rest) => new RegExp(prefix + rest);

export const SECRET_SHAPES = Object.freeze([
  { kind: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'GitHub token', pattern: TOKEN('\\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat', '_[A-Za-z0-9_]{50,})') },
  { kind: 'Slack token', pattern: TOKEN('\\bxox[abposr]', '-[A-Za-z0-9-]{10,}') },
  { kind: 'Stripe key', pattern: TOKEN('\\b[sr]k_(?:live|test)', '_[A-Za-z0-9]{16,}') },
  { kind: 'Sentry auth token', pattern: TOKEN('\\bsntry[su]', '_[A-Za-z0-9+/=_-]{20,}') },
  { kind: 'Expo or Sentry token assignment', pattern: /\b(?:EXPO_TOKEN|SENTRY_AUTH_TOKEN)\s*[=:]\s*['"]?[A-Za-z0-9._-]{20,}/ },
  { kind: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // A password that starts with a template character ($, {, <, %) is a placeholder, not a credential.
  { kind: 'database URI with a password', pattern: /\bpostgres(?:ql)?:\/\/[^\s:@/'"`]+:(?![$<{%])[^\s@/'"`]+@/i },
]);

// Names that mark secret material no matter what the file holds.
const SECRET_FILE_NAMES = Object.freeze([
  { kind: 'environment file', pattern: /(?:^|\/)\.env(?:\.(?!example$)[^/]*)?$/ },
  { kind: 'key or certificate file', pattern: /\.(?:pem|p8|p12|jks|keystore)$/i },
  { kind: 'credentials file', pattern: /(?:^|\/)credentials[^/]*\.json$/i },
  { kind: 'saved test session', pattern: /(?:^|\/)tests\/e2e\/\.auth\// },
]);

/** The kinds of secret in one line of text. Never returns the matched text. */
export function findSecretKinds(text) {
  if (text.includes('secret-scan: allow')) return [];
  return [
    ...SECRET_SHAPES.filter(({ pattern }) => pattern.test(text)).map(({ kind }) => kind),
    ...findKinds(text),
  ];
}

/** The kinds of secret a file NAME implies. */
export function findFileKinds(path) {
  return SECRET_FILE_NAMES.filter(({ pattern }) => pattern.test(path)).map(({ kind }) => kind);
}

/** Every finding in a staged diff and name list: `{where, kind}`. */
export function scan({ diff, files }) {
  const findings = [];
  for (const file of files) {
    for (const kind of findFileKinds(file)) findings.push({ where: file, kind });
  }
  for (const { file, line, text } of addedLines(diff)) {
    for (const kind of findSecretKinds(text)) findings.push({ where: `${file}:${line}`, kind });
  }
  return findings;
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function main() {
  let diff;
  let files;
  try {
    const common = ['-c', 'core.quotePath=false', 'diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv'];
    files = git([...common, '--name-only', '--diff-filter=ACMR']).split('\n').filter(Boolean);
    diff = git([...common, '--unified=0', '--diff-filter=ACMR']);
  } catch (error) {
    const reason = String(error.stderr || error.message).trim().split('\n')[0];
    console.error(`scan-staged-secrets: cannot read the staged diff (${reason}). Run it inside the git checkout.`);
    process.exit(2);
  }
  const findings = scan({ diff, files });
  for (const { where, kind } of findings) {
    console.error(`${where}: ${kind}`);
  }
  if (findings.length > 0) {
    console.error(
      `scan-staged-secrets: ${findings.length} finding(s); matched text is not printed. ` +
        'Unstage the value and move it to the environment, or end a safe line with "secret-scan: allow <reason>". ' +
        'See docs/security/secret-handling.md.',
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
