#!/usr/bin/env node
// Public-repo leak gate for CI. Scans the lines ADDED between two refs, and the
// commit messages in that range, for internal-leak shapes: private IPv4
// addresses, private key headers, home-directory server paths, and an optional
// term list from PUBLIC_TEXT_PRIVATE_TERMS (newline-separated, case-insensitive;
// unset = skipped). Output names file, line and KIND only, never the match.
//
// Usage: node scripts/ci/check-public-text.mjs --base <ref> --head <ref>
// Exit:  0 clean, 1 leak found, 2 usage or git error.
// Allowlist: end a line with the marker `public-text: allow` (in a comment).
//
// The Android emulator's host alias (the 10.0.2.2 address) is not a leak and is skipped.
// shortcut: reads whole diff into memory (256 MB cap), upgrade if ranges outgrow it.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
// Pieces are joined at runtime so this file never matches its own patterns.
const KEY_HEADER = new RegExp('-----BEGIN (?:[A-Z0-9]+ )*PRIV' + 'ATE KEY-----');

export const ALLOW_MARKER = 'public-text: allow';

export const SHAPES = Object.freeze([
  {
    kind: 'private IPv4 address',
    pattern: new RegExp(
      String.raw`(?<![\d.])(?!10\.0\.2\.2(?!\d|\.\d))(?:10\.${OCTET}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.${OCTET}\.${OCTET}(?!\d|\.\d)`,
    ),
  },
  { kind: 'private key header', pattern: KEY_HEADER },
  { kind: 'home-directory server path', pattern: /\/home\/[a-z_][a-z0-9_-]*\//i },
]);

/** The kinds of leak in one line of text. Never returns the matched text. */
export function findKinds(text, terms = []) {
  if (text.includes(ALLOW_MARKER)) return [];
  const kinds = SHAPES.filter(({ pattern }) => pattern.test(text)).map(({ kind }) => kind);
  const lower = text.toLowerCase();
  if (terms.some(term => lower.includes(term))) kinds.push('private term');
  return kinds;
}

/** The added lines of a `--unified=0` diff, as `{file, line, text}`. */
export function addedLines(diff) {
  const out = [];
  let file = null;
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw === '+++ /dev/null' ? null : raw.slice(6).replace(/\t$/, '');
    } else if (raw.startsWith('@@')) {
      line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0);
    } else if (raw.startsWith('+') && file !== null) {
      out.push({ file, line, text: raw.slice(1) });
      line += 1;
    }
  }
  return out;
}

/** Every finding in the commits and the diff: `{where, file?, line?, kind}`. */
export function check({ commits, diff, terms = [] }) {
  const findings = [];
  for (const { sha, message } of commits) {
    for (const text of message.split('\n')) {
      for (const kind of findKinds(text, terms)) {
        findings.push({ where: `commit ${sha.slice(0, 7)} message`, kind });
      }
    }
  }
  for (const { file, line, text } of addedLines(diff)) {
    for (const kind of findKinds(text, terms)) {
      findings.push({ where: `${file}:${line}`, file, line, kind });
    }
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

function readRange(base, head) {
  const range = `${base}..${head}`;
  const commits = git(['log', '--format=%H%x00%B%x1e', range, '--'])
    .split('\x1e')
    .map(entry => entry.replace(/^\n/, ''))
    .filter(Boolean)
    .map(entry => {
      const [sha, message = ''] = entry.split('\x00');
      return { sha, message };
    });
  // Three dots diff against the merge base, so lines the base branch changed after the fork are not blamed on head.
  // Binary files give no `+` lines, so they are not scanned.
  const diff = git([
    '-c', 'core.quotePath=false',
    'diff', '--unified=0', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames',
    `${base}...${head}`, '--',
  ]);
  return { commits, diff };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if ((key !== '--base' && key !== '--head') || !argv[i + 1] || argv[i + 1].startsWith('-')) {
      return null;
    }
    args[key.slice(2)] = argv[i + 1];
  }
  return args.base && args.head ? args : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('Usage: check-public-text.mjs --base <ref> --head <ref>');
    process.exit(2);
  }
  const terms = (process.env.PUBLIC_TEXT_PRIVATE_TERMS ?? '')
    .split('\n')
    .map(term => term.trim().toLowerCase())
    .filter(Boolean);
  let range;
  try {
    range = readRange(args.base, args.head);
  } catch (error) {
    const reason = String(error.stderr || error.message).trim().split('\n')[0];
    console.error(`check-public-text: cannot read ${args.base}..${args.head} (${reason}). Fetch both refs and retry.`);
    process.exit(2);
  }
  const findings = check({ ...range, terms });
  for (const { where, file, line, kind } of findings) {
    const at = file ? ` file=${file},line=${line},` : ' ';
    console.log(`::error${at}title=Public text check::${where} has a ${kind}. Remove it, or end the line with "${ALLOW_MARKER}" if it is intended.`);
  }
  if (findings.length > 0) {
    console.log(`${findings.length} finding(s). Matched text is not printed.`);
    process.exit(1);
  }
  console.log(`Checked ${range.commits.length} commit message(s) and the added lines: no internal-leak shapes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
