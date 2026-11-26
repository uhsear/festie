#!/usr/bin/env node
/**
 * check-ground.mjs — fail when a static launch surface uses a ground colour that is not the token.
 * Reads bg.primary from packages/shared/src/tokens/colors.ts (stage) and colorsDaylight.ts, then
 * compares the static HTML, JS, JSON and script copies that cannot import the token module.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const ground = (file) => /bg:\s*\{\s*primary:\s*'(#[0-9a-f]{6})'/i.exec(read(`packages/shared/src/tokens/${file}`))?.[1];

const stage = ground('colors.ts');
const daylight = ground('colorsDaylight.ts');
if (!stage || !daylight) {
  console.error('check-ground: could not read bg.primary from the token files.');
  process.exit(1);
}

const errors = [];
const expect = (label, ok) => ok || errors.push(label);

const html = read('packages/web/index.html');
const metas = [...html.matchAll(/<meta name="theme-color" content="(#[0-9a-f]{6})" media="\(prefers-color-scheme: (dark|light)\)"/gi)];
const meta = (scheme) => metas.find((m) => m[2] === scheme)?.[1];
expect(`web/index.html dark theme-color is not ${stage}`, meta('dark') === stage);
expect(`web/index.html light theme-color is not ${daylight}`, meta('light') === daylight);
expect(`web/index.html boot shell ground is not ${stage}`, new RegExp(String.raw`[.]boot-shell [{][^}]*background: ${stage}`).test(html));
expect(`web/index.html daylight boot shell ground is not ${daylight}`, new RegExp(String.raw`data-theme='daylight'[\]] [.]boot-shell [{][^}]*background: ${daylight}`).test(html));

const init = read('packages/web/public/theme-init.js');
expect(`web/public/theme-init.js does not use ${stage} and ${daylight}`, init.includes(`'${stage}'`) && init.includes(`'${daylight}'`));

const manifest = read('packages/mobile/scripts/build-manifest.mjs');
expect(`mobile build-manifest.mjs theme_color/background_color are not ${stage}`,
  new RegExp(String.raw`theme_color: *'${stage}'`).test(manifest) && new RegExp(String.raw`background_color: *'${stage}'`).test(manifest));
expect(`mobile build-manifest.mjs theme-color meta is not ${stage}`, manifest.includes(`name="theme-color" content="${stage}"`));

const app = JSON.parse(read('packages/mobile/app.json')).expo;
const splash = app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen')?.[1]?.backgroundColor;
expect(`mobile app.json splash backgroundColor is ${splash}, not ${stage}`, splash === stage);
expect(`mobile app.json adaptiveIcon backgroundColor is ${app.android?.adaptiveIcon?.backgroundColor}, not ${stage}`,
  app.android?.adaptiveIcon?.backgroundColor === stage);

if (errors.length) {
  console.error(`check-ground: ${errors.length} mismatch(es)\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`check-ground: ok (stage ${stage}, daylight ${daylight})`);
