// Design drift ratchet (DP-12). Counts today's design-token offenders per file and rule.
// The check fails when a count rises, when a file gains an offender that has no allowlist
// entry, or when an entry has no reason. Later items lower the counts, then delete entries.
// Hex and rgb entries are the exception: they end as a named exception list, not at zero.
//
//   node scripts/ci/design-ratchet.mjs <web|mobile|server|all>           check
//   node scripts/ci/design-ratchet.mjs <web|mobile|server|all> --write   set every max to today's count
//
// ESLint (packages/*/eslint.config.js) gives instant feedback on files outside the allowlist.
// This check is the count guard, so it also covers CSS and the allowlisted files.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const HEX = /(?<![&\w])#[0-9a-fA-F]{3,8}\b/g;

export const TARGETS = {
  web: {
    dir: 'packages/web',
    allowlist: 'packages/web/design-ratchet.allowlist.json',
    exts: ['.ts', '.tsx', '.css'],
    skipDirs: ['node_modules', 'dist', '__tests__'],
    skipFile: (name) => /\.(test|spec|stories)\.[tj]sx?$/.test(name) || name === 'theme.generated.css',
    roots: ['src'],
    rules: {
      hex: { re: HEX, seed: 'Offender today. DP-28 tokenises it or names a reason to keep it.' },
      rgb: { re: /\brgba?\(/g, seed: 'Offender today. DP-28 tokenises it or names a reason to keep it.' },
      'text-px': { re: /\btext-\[\d/g, seed: 'Offender today. TK-19 removes it, then the entry is deleted.' },
      duration: { re: /\bduration-(\d|\[)/g, seed: 'Offender today. DP-47 moves it to a motion token, then the entry is deleted.' },
      ease: { re: /\bease-\[ease/g, seed: 'Offender today. DP-47 moves it to a motion token, then the entry is deleted.' },
    },
  },
  // Server-rendered HTML that lives inside a route or mail module. Static pages are covered by tests/static-pages.test.ts.
  server: {
    dir: '.',
    allowlist: 'scripts/ci/design-ratchet.server.allowlist.json',
    files: ['routes/email-auth.ts', 'lib/email.ts'],
    rules: {
      hex: { re: HEX, seed: 'Offender today. Take the value from lib/design-css.ts instead.' },
      rgb: { re: /\brgba?\(/g, seed: 'Offender today. Take the value from lib/design-css.ts instead.' },
    },
  },
  mobile: {
    dir: 'packages/mobile',
    allowlist: 'packages/mobile/design-ratchet.allowlist.json',
    exts: ['.ts', '.tsx'],
    skipDirs: ['node_modules', '__tests__', 'vendor', 'android', 'ios', 'maestro', 'scripts', 'assets', '.expo', 'dist'],
    skipFile: (name) => /\.test\.[tj]sx?$/.test(name),
    // Token source and fixed-artwork posters may hold raw values.
    exempt: (file, rule) =>
      ['hex', 'fontSize', 'fontFamily'].includes(rule) && (file === 'hooks/useTokens.ts' || /Poster\.tsx$/.test(file)),
    rules: {
      hex: { re: HEX, seed: 'Offender today. DP-29 tokenises it or names a reason to keep it.' },
      fontSize: { re: /\bfontSize\s*:/g, seed: 'Offender today. DP-25 moves it to typeStyle(), then the entry is deleted.' },
      fontFamily: { re: /\bfontFamily\s*:/g, seed: 'Offender today. DP-25 moves it to typeStyle(), then the entry is deleted.' },
      'ionicons-size': {
        re: /<Ionicons\b[^>]*?\bsize=\{\s*\d/gs,
        seed: 'Offender today. TK-21 moves it to an icon size token, then the entry is deleted.',
      },
      'duration-ms': {
        re: /\bduration:\s*\d|\bwithDelay\(\s*\d|\.(delay|duration)\(\s*\d/g,
        seed: 'Offender today. DP-47 moves it to a motion token, then the entry is deleted.',
      },
      'animated-true': { re: /\banimated:\s*true/g, seed: 'Offender today. DP-49 honours reduced motion, then the entry is deleted.' },
    },
  },
};

function* walk(abs, target) {
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const full = join(abs, entry.name);
    if (entry.isDirectory()) {
      if (!target.skipDirs.includes(entry.name)) yield* walk(full, target);
    } else if (target.exts.some((ext) => entry.name.endsWith(ext)) && !target.skipFile(entry.name)) {
      yield full;
    }
  }
}

/** Returns Map<"file|rule", count>; file paths are relative to the package, with forward slashes. */
export function scan(name, repo = REPO) {
  const target = TARGETS[name];
  const pkg = join(repo, target.dir);
  const counts = new Map();
  const paths = target.files
    ? [target.files.map((f) => join(pkg, f)).filter(existsSync)]
    : (target.roots ?? ['']).map((root) => walk(join(pkg, root), target));
  for (const group of paths) {
    for (const abs of group) {
      const file = relative(pkg, abs).split('\\').join('/');
      const text = readFileSync(abs, 'utf8');
      for (const [rule, { re }] of Object.entries(target.rules)) {
        if (target.exempt?.(file, rule)) continue;
        const n = (text.match(re) ?? []).length;
        if (n > 0) counts.set(`${file}|${rule}`, n);
      }
    }
  }
  return counts;
}

export function loadAllowlist(name, repo = REPO) {
  return JSON.parse(readFileSync(join(repo, TARGETS[name].allowlist), 'utf8'));
}

/** Returns a list of problem strings. An empty list means the ratchet holds. */
export function check(name, repo = REPO, allowlist = loadAllowlist(name, repo)) {
  const rules = TARGETS[name].rules;
  const problems = [];
  const allowed = new Map();
  for (const e of allowlist.entries) {
    const key = `${e.file}|${e.rule}`;
    if (!rules[e.rule]) problems.push(`${key}: unknown rule`);
    if (typeof e.reason !== 'string' || e.reason.trim() === '') problems.push(`${key}: allowlist entry has no reason`);
    if (!Number.isInteger(e.max) || e.max < 1) problems.push(`${key}: max must be a positive integer`);
    allowed.set(key, e.max);
  }
  for (const [key, count] of scan(name, repo)) {
    const max = allowed.get(key);
    if (max === undefined) problems.push(`${key}: ${count} new offender(s), not in the allowlist. Use a token instead.`);
    else if (count > max) problems.push(`${key}: ${count} offenders, allowlist max is ${max}. Use a token instead.`);
  }
  return problems;
}

/** Sets every max to today's count. Keeps existing reasons; drops entries that reached zero. */
export function write(name, repo = REPO) {
  const target = TARGETS[name];
  const old = new Map(loadAllowlist(name, repo).entries.map((e) => [`${e.file}|${e.rule}`, e.reason]));
  const entries = [...scan(name, repo)]
    .map(([key, max]) => {
      const [file, rule] = key.split('|');
      return { file, rule, max, reason: old.get(key) ?? target.rules[rule].seed };
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
  writeFileSync(join(repo, target.allowlist), `${JSON.stringify({ entries }, null, 2)}\n`);
  return entries.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [which, flag] = process.argv.slice(2);
  const names = which === 'all' ? Object.keys(TARGETS) : [which];
  if (!names.every((n) => TARGETS[n])) {
    console.error('Usage: node scripts/ci/design-ratchet.mjs <web|mobile|server|all> [--write]');
    process.exit(2);
  }
  let failed = false;
  for (const name of names) {
    if (flag === '--write') {
      console.log(`${name}: wrote ${write(name)} allowlist entries`);
      continue;
    }
    const problems = check(name);
    for (const p of problems) console.error(`design-ratchet ${name}: ${p}`);
    if (problems.length) failed = true;
    else console.log(`design-ratchet ${name}: ok`);
  }
  process.exit(failed ? 1 : 0);
}
