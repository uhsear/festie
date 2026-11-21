#!/usr/bin/env node
// Pre-commit secret gate. Scans the lines ADDED in the staged diff for credential
// shapes and public-repo hygiene shapes (the same ones CI's check-public-text uses),
// and rejects staged files whose NAME marks them as secret material. Output names
// file, line and KIND only, never the matched text.
//
// Usage: node scripts/ci/scan-staged-secrets.mjs [--all]   (run by lint-staged)
//        --all scans every tracked file in the working tree instead of the staged diff.
// Exit:  0 clean, 1 finding, 2 git error.
// Allowlist: end a line with a comment `secret-scan: allow <reason>`. The reason is required.
//
// This is a fast first layer. CI runs gitleaks over the full PR range as the real gate.
// shortcut: reads the whole staged diff into memory, upgrade if commits outgrow it.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { addedLines, findKinds, SECRET_ALLOW_PATTERN } from './check-public-text.mjs';

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
  // Template forms (${VAR}, <placeholder>, {{x}}, %(x)s) are placeholders. Loopback and example hosts
  // and a short list of obvious dummy passwords are exempt too (see isPlaceholderDbUri).
  {
    kind: 'database URI with a password',
    pattern: /\bpostgres(?:ql)?:\/\/[^\s:@/'"`]+:(?!(?:\$\{[^}\s]*\}|<[^>\s]*>|\{\{[^}\s]*\}\}|%\([^)\s]*\)s)@)([^\s/'"`]+)@(\[[^\]\s]*\]|[^\s:/@'"`?#]+)/i,
    exempt: ([, password, host]) => isPlaceholderDbUri(password, host),
  },
]);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PLACEHOLDER_PASSWORDS = new Set(['p', 'pass', 'password', 'test_password', 'postgres', 'festie', 'x']);

function isPlaceholderDbUri(password, host) {
  const h = host.toLowerCase();
  return LOOPBACK_HOSTS.has(h) || h.startsWith('example.') || PLACEHOLDER_PASSWORDS.has(password.toLowerCase());
}

/** True when the shape matches the text somewhere that its exemption does not cover. */
function matchesShape({ pattern, exempt }, text) {
  if (!exempt) return pattern.test(text);
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))].some(match => !exempt(match));
}

// Names that mark secret material no matter what the file holds.
const SECRET_FILE_NAMES = Object.freeze([
  { kind: 'environment file', pattern: /(?:^|\/)\.env(?:\.(?!example$)[^/]*)?$/ },
  { kind: 'key or certificate file', pattern: /\.(?:pem|p8|p12|jks|keystore|key)$/i },
  { kind: 'credentials file', pattern: /(?:^|\/)credentials[^/]*\.json$/i },
  { kind: 'service-account or Firebase credentials file', pattern: /(?:^|\/)(?:[^/]*service-account[^/]*\.json|festie-[^/]*\.json|play-store-key[^/]*\.json|google-services\.json|GoogleService-Info\.plist)$/i },
  { kind: 'saved test session', pattern: /(?:^|\/)tests\/e2e\/\.auth\// },
]);

// Already tracked on purpose: the Firebase client config is a public key by design, so edits stay allowed.
const TRACKED_SECRET_NAME_EXCEPTIONS = Object.freeze(['packages/mobile/google-services.json']);

/** The kinds of secret in one line of text. Never returns the matched text. */
export function findSecretKinds(text, file = '') {
  if (SECRET_ALLOW_PATTERN.test(text)) return [];
  return [
    ...SECRET_SHAPES.filter(shape => matchesShape(shape, text)).map(({ kind }) => kind),
    ...findKinds(text, [], file),
  ];
}

/** The kinds of secret a file NAME implies. */
export function findFileKinds(path) {
  if (TRACKED_SECRET_NAME_EXCEPTIONS.includes(path)) return [];
  return SECRET_FILE_NAMES.filter(({ pattern }) => pattern.test(path)).map(({ kind }) => kind);
}

/** Every finding in a staged diff and name list: `{where, kind}`. */
export function scan({ diff, files }) {
  const findings = [];
  for (const file of files) {
    for (const kind of findFileKinds(file)) findings.push({ where: file, kind });
  }
  for (const { file, line, text } of addedLines(diff)) {
    for (const kind of findSecretKinds(text, file)) findings.push({ where: `${file}:${line}`, kind });
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

function scanTree(files) {
  const findings = files.flatMap(file => findFileKinds(file).map(kind => ({ where: file, kind })));
  for (const file of files) {
    const content = readFileSync(file);
    if (content.includes(0)) continue;
    content.toString('utf8').split('\n').forEach((text, i) => {
      for (const kind of findSecretKinds(text, file)) findings.push({ where: `${file}:${i + 1}`, kind });
    });
  }
  return findings;
}

function main() {
  let diff;
  let files;
  try {
    if (process.argv.includes('--all')) {
      const tracked = git(['-c', 'core.quotePath=false', 'ls-files', '-z']).split('\0').filter(Boolean);
      return report(scanTree(tracked));
    }
    const common = ['-c', 'core.quotePath=false', 'diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv'];
    files = git([...common, '--name-only', '--diff-filter=ACMR']).split('\n').filter(Boolean);
    diff = git([...common, '--unified=0', '--diff-filter=ACMR']);
  } catch (error) {
    const reason = String(error.stderr || error.message).trim().split('\n')[0];
    console.error(`scan-staged-secrets: cannot read the staged diff (${reason}). Run it inside the git checkout.`);
    process.exit(2);
  }
  report(scan({ diff, files }));
}

function report(findings) {
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
