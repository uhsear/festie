#!/usr/bin/env node
// Release gate: fails while a "[TODO" placeholder is still in a published legal page or in the
// mobile privacy screen. Run it before every deploy or OTA that ships these files. It is not
// part of `npm test`, because the placeholders are legitimate on a branch until the owner fills them.
//
// Usage: node scripts/ci/check-legal-placeholders.mjs [--root <repo>]
// Exit 0 = no placeholders, 1 = at least one placeholder found.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = /\[TODO/;
const MOBILE_FILES = ['packages/mobile/app/privacy.tsx'];

/** Returns "file:line: text" for every line that still holds a placeholder. */
function findPlaceholders(root) {
  const publicDir = path.join(root, 'public');
  const files = [
    ...fs.readdirSync(publicDir).filter((name) => name.endsWith('.html')).map((name) => `public/${name}`),
    ...MOBILE_FILES,
  ];
  const hits = [];
  for (const file of files) {
    fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => {
      if (MARKER.test(line)) hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootFlag = process.argv.indexOf('--root');
  const root = rootFlag === -1 ? process.cwd() : path.resolve(process.argv[rootFlag + 1]);
  const hits = findPlaceholders(root);
  if (hits.length > 0) {
    console.error(`${hits.length} placeholder(s) left in published legal text. Fill each one before release:`);
    for (const hit of hits) console.error(`  ${hit}`);
    process.exit(1);
  }
  console.log('No [TODO placeholders in public/*.html or the mobile privacy screen.');
}
