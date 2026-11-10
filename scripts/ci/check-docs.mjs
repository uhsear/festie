#!/usr/bin/env node
// Docs-vs-code drift gate. Two assertions:
//   1. Every repo path cited in ARCHITECTURE.md, docs/SOCKET_CONTRACT.md and docs/adrs/*.md exists.
//   2. Every Socket.IO event name emitted by server code appears in docs/SOCKET_CONTRACT.md.
//
// Usage: node scripts/ci/check-docs.mjs [--root <repo>] [--docs-root <dir holding the docs>]
// Exit 0 = clean (or docs absent), 1 = drift found.
//
// Those docs are gitignored in the public repo (see .gitignore, "Internal docs"), so a fresh
// public checkout has none of them: the script then reports "skipped" and exits 0. It does real
// work on a workstation or server checkout that holds the docs.
//
// shortcut: event names are found by regex on `.emit('literal'`; a name built at runtime is
// invisible. Upgrade to the TypeScript AST if an emitter ever computes event names.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOC_FILES = ['ARCHITECTURE.md', 'docs/SOCKET_CONTRACT.md'];
const ADR_DIR = 'docs/adrs';
const CONTRACT = 'docs/SOCKET_CONTRACT.md';
const EMIT_SOURCES = ['lib', 'routes', 'server.ts'];

// Intentional exceptions. Keep these small and give every entry a reason.
const IGNORED_PATHS = new Map([
  ['pm2/lib/God/ForkMode.js', 'third-party file inside node_modules/pm2, cited to explain a pm2 behaviour'],
]);
const IGNORED_PREFIXES = new Map([
  ['dist/', 'build output from npm run build; gitignored, so absent from a fresh checkout'],
]);
const IGNORED_EVENTS = new Map([
  // ['event:name', 'why it is intentionally undocumented'],
]);

const SOURCE_EXT = /\.(?:ts|js|mjs|cjs)$/;
const EMIT_RE = /\.emit\(\s*(['"`])([^'"`$\\]+)\1/g;
const BACKTICK_RE = /`([^`\n]+)`/g;
const LINK_RE = /\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const NOT_A_PATH_CHARS = /[\s*{}<>$?|()[\]\\=,;'"~]|:\/\/|\.\.\./;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  if (fs.statSync(dir).isFile()) return [dir];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

// Blank out fenced code blocks but keep their newlines so line numbers stay true.
function stripFencedCode(text) {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (block) => block.replace(/[^\n]/g, ''));
}

// Returns the repo-relative path a backticked token cites, or null when it is not a path citation.
export function pathFromToken(token) {
  const t = token.trim().replace(/:\d+(?:-\d+)?$/, '').replace(/#.*$/, '');
  if (!t.includes('/') || NOT_A_PATH_CHARS.test(t)) return null;
  // API routes (/api/..), npm scopes (@festie/..) and ./x, ../x (relative to whichever module the prose
  // discusses, not to the repo root) are not repo-root citations.
  if (/^[/@]|^\.\.?\//.test(t)) return null;
  if (!(t.endsWith('/') || /\.[A-Za-z0-9]+$/.test(t))) return null;
  if (/^[\w-]+\.(?:us|com|io|org|net|dev|app)\//.test(t)) return null;
  return t;
}

function citedPaths(text) {
  const cited = [];
  stripFencedCode(text).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(BACKTICK_RE)) {
      const p = pathFromToken(m[1]);
      if (p) cited.push({ path: p, line: i + 1, relativeToDoc: false });
    }
    for (const m of line.matchAll(LINK_RE)) {
      const target = m[1].replace(/#.*$/, '');
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || /[*{}<>]/.test(target)) continue;
      cited.push({ path: target, line: i + 1, relativeToDoc: true });
    }
  });
  return cited;
}

function isIgnoredPath(p) {
  return IGNORED_PATHS.has(p) || [...IGNORED_PREFIXES.keys()].some((prefix) => p.startsWith(prefix));
}

function pathExists(repoRoot, docsRoot, docRel, cite) {
  const candidates = [path.join(repoRoot, cite.path)];
  if (cite.relativeToDoc) candidates.unshift(path.join(docsRoot, path.dirname(docRel), cite.path));
  return candidates.some((c) => fs.existsSync(c));
}

export function collectEmittedEvents(repoRoot) {
  const events = new Map();
  for (const src of EMIT_SOURCES) {
    for (const file of walk(path.join(repoRoot, src))) {
      if (!SOURCE_EXT.test(file) || /\.d\.ts$|\.test\./.test(file)) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
        for (const m of line.matchAll(EMIT_RE)) {
          const where = `${path.relative(repoRoot, file).split(path.sep).join('/')}:${i + 1}`;
          if (!events.has(m[2])) events.set(m[2], where);
        }
      });
    }
  }
  return events;
}

export function checkDocs({ root, docsRoot = root }) {
  const problems = [];
  const notes = [];

  const adrDir = path.join(docsRoot, ADR_DIR);
  const adrs = fs.existsSync(adrDir)
    ? fs.readdirSync(adrDir).filter((f) => f.endsWith('.md')).map((f) => `${ADR_DIR}/${f}`)
    : [];
  const docs = [...DOC_FILES, ...adrs].filter((rel) => {
    if (fs.existsSync(path.join(docsRoot, rel))) return true;
    notes.push(`skipped ${rel}: not present under ${docsRoot}`);
    return false;
  });

  for (const rel of docs) {
    const text = fs.readFileSync(path.join(docsRoot, rel), 'utf8');
    for (const cite of citedPaths(text)) {
      if (isIgnoredPath(cite.path) || pathExists(root, docsRoot, rel, cite)) continue;
      problems.push(
        `${rel}:${cite.line} cites \`${cite.path}\` but it does not exist. Fix the citation, or add it to IGNORED_PATHS in scripts/ci/check-docs.mjs with a reason.`,
      );
    }
  }

  const contractPath = path.join(docsRoot, CONTRACT);
  if (fs.existsSync(contractPath)) {
    const contract = fs.readFileSync(contractPath, 'utf8');
    for (const [event, where] of collectEmittedEvents(root)) {
      if (IGNORED_EVENTS.has(event) || contract.includes(`\`${event}\``)) continue;
      problems.push(
        `${where} emits \`${event}\` but ${CONTRACT} does not document it. Add a section for it, or add it to IGNORED_EVENTS in scripts/ci/check-docs.mjs with a reason.`,
      );
    }
  }
  return { problems, notes };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const root = path.resolve(flag('--root') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const docsRoot = path.resolve(flag('--docs-root') ?? root);
  const { problems, notes } = checkDocs({ root, docsRoot });
  for (const n of notes) console.log(`check-docs: ${n}`);
  if (problems.length) {
    console.error(`check-docs: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('check-docs: OK');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
