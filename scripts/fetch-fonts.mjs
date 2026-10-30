#!/usr/bin/env node
// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
//
// fetch-fonts.mjs — copy the licensed Clash Display files into this checkout.
//
// The ITF Free Font License (section 53) forbids distributing the font files through
// a public repository, so they live in the private repo uhsear/festie-fonts at the
// same paths and are gitignored here. Run this before a web build or a mobile bundle:
//
//   node scripts/fetch-fonts.mjs             # exit 1 if the fonts cannot be fetched
//   node scripts/fetch-fonts.mjs --optional  # warn and exit 0 instead
//
// Access, in order:
//   FESTIE_FONTS_SSH_KEY  private deploy key (GitHub Actions secret) — cloned over SSH
//   FESTIE_FONTS_REPO     clone URL override
//   default               https://github.com/uhsear/festie-fonts.git with the
//                         machine's own git credentials
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  ...['Regular', 'Medium', 'Semibold', 'Bold'].map((w) => `packages/mobile/assets/fonts/clash-display/ClashDisplay-${w}.otf`),
  'packages/mobile/assets/fonts/clash-display/FFL.txt',
  ...[400, 500, 600, 700].map((w) => `packages/web/public/fonts/clash-display/clash-display-${w}.woff2`),
];
// GitHub's published ed25519 host key (gh api meta), so the SSH clone never trusts on first use.
const GITHUB_HOST_KEY = 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
const optional = process.argv.includes('--optional');

const missing = () => FILES.filter((f) => !existsSync(join(ROOT, f)));
if (missing().length === 0) process.exit(0);

const work = mkdtempSync(join(tmpdir(), 'festie-fonts-'));
try {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  let url = process.env.FESTIE_FONTS_REPO || 'https://github.com/uhsear/festie-fonts.git';
  const key = process.env.FESTIE_FONTS_SSH_KEY;
  if (key) {
    const keyFile = join(work, 'key');
    const hostsFile = join(work, 'known_hosts');
    writeFileSync(keyFile, key.trim() + '\n', { mode: 0o600 });
    writeFileSync(hostsFile, GITHUB_HOST_KEY + '\n');
    env.GIT_SSH_COMMAND = `ssh -i "${keyFile}" -o IdentitiesOnly=yes -o UserKnownHostsFile="${hostsFile}" -o StrictHostKeyChecking=yes`;
    url = 'git@github.com:uhsear/festie-fonts.git';
  }
  execFileSync('git', ['clone', '--quiet', '--depth', '1', url, join(work, 'repo')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  for (const f of FILES) {
    mkdirSync(dirname(join(ROOT, f)), { recursive: true });
    copyFileSync(join(work, 'repo', f), join(ROOT, f));
  }
  const left = missing();
  if (left.length) throw new Error(`still missing after copy: ${left.join(', ')}`);
  console.log(`fetch-fonts: copied ${FILES.length} files from uhsear/festie-fonts`);
} catch (err) {
  const detail = err.stderr?.toString().trim() || err.message;
  console.error(`fetch-fonts: could not fetch the Clash Display fonts (${detail}).`);
  console.error('  Fix: get read access to uhsear/festie-fonts, or set FESTIE_FONTS_SSH_KEY to its deploy key.');
  // exitCode, not exit(): the finally block must still delete the key file.
  if (optional) console.error('  Continuing without them: headings fall back to the system font.');
  else process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
