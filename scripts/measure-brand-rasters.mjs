#!/usr/bin/env node
/**
 * measure-brand-rasters.mjs: reports, for each brand raster, the mark's bounding box as a percentage of
 * the canvas, the farthest mark pixel from the centre (radius as a percentage of the canvas width) and the
 * four corner pixel colours. With --check it also fails when:
 *   - an opaque raster's corners are not the token ground (bg.primary; Daylight rasters use the Daylight ground),
 *   - an adaptive foreground or monochrome mark leaves the circular safe zone (centre 66 of 108 dp),
 *   - the favicon masters leave under 2 px between pin and tent in a 16 px render (a full ground pixel).
 * It also warns, without failing, when the splash icon mark leaves the Android 12 circular mask (centre 2/3 of the
 * canvas): the mask size is only confirmed by an emulator capture.
 * The mark is every pixel with alpha above 16 on transparent art, or every pixel that differs from the
 * top-left corner colour by more than 24 in any channel on opaque art.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const ground = (file) => /bg:\s*\{\s*primary:\s*'(#[0-9a-f]{6})'/i.exec(readFileSync(root(`packages/shared/src/tokens/${file}`), 'utf8'))?.[1];
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const stage = hexToRgb(ground('colors.ts'));
const daylight = hexToRgb(ground('colorsDaylight.ts'));
const SAFE_ADAPTIVE = 66 / 108; // diameter of the guaranteed-visible circle, as a share of the 108 dp canvas
const SAFE_SPLASH = 2 / 3; // Android 12 splash icon mask, as a share of the icon canvas

// advisory: warn only. kind: ground = opaque raster that must sit on the stage ground; daylight = opaque on the Daylight ground;
// layer = transparent art, no ground check.
const FILES = [
  { rel: 'packages/web/public/apple-touch-icon.png', kind: 'ground' },
  { rel: 'packages/web/public/icons/icon-192.png', kind: 'ground' },
  { rel: 'packages/web/public/icons/icon-512.png', kind: 'ground' },
  { rel: 'packages/web/public/icons/icon-maskable-512.png', kind: 'ground' },
  { rel: 'packages/mobile/assets/icon.png', kind: 'ground' },
  { rel: 'packages/mobile/assets/favicon.png', kind: 'layer' },
  { rel: 'packages/mobile/assets/android-icon-background.png', kind: 'ground' },
  { rel: 'packages/mobile/assets/android-icon-foreground.png', kind: 'layer', safe: SAFE_ADAPTIVE },
  { rel: 'packages/mobile/assets/android-icon-monochrome.png', kind: 'layer', safe: SAFE_ADAPTIVE },
  { rel: 'packages/mobile/assets/notification-icon.png', kind: 'layer' },
  { rel: 'packages/mobile/assets/splash-icon.png', kind: 'layer', safe: SAFE_SPLASH, advisory: true },
  { rel: 'packages/mobile/assets/splash-icon-daylight.png', kind: 'layer', safe: SAFE_SPLASH, advisory: true },
];

async function measure({ rel, kind, safe, advisory }) {
  const { data, info } = await sharp(root(rel)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = (x, y) => Array.from(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  const base = corners[0];
  const isMark = (p) => (base[3] < 255 || kind === 'layer' ? p[3] > 16 : [0, 1, 2].some((c) => Math.abs(p[c] - base[c]) > 24));
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  let farthest = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isMark(px(x, y))) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      farthest = Math.max(farthest, Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2));
    }
  }
  return { rel, kind, safe, advisory, w, h, corners, bbox: [x0, y0, x1 + 1, y1 + 1], farthestPct: (200 * farthest) / w };
}

// Gap between the pin and the tent in a favicon master, in pixels of a 16 px render.
async function faviconGapAt16(rel) {
  const svg = readFileSync(root(rel), 'utf8');
  const [tent, pin] = svg.match(/<path[^>]*\/>/g);
  const open = svg.slice(0, svg.indexOf('>') + 1);
  const shape = async (path) => {
    const { data, info } = await sharp(Buffer.from(`${open.replace('<svg', '<svg width="256" height="256"')}${path}</svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const hits = [];
    for (let i = 0; i < info.width * info.height; i++) if (data[i * 4 + 3] > 127) hits.push([i % info.width, Math.floor(i / info.width)]);
    return hits;
  };
  const [tentPx, pinPx] = [await shape(tent), await shape(pin)];
  let min = Infinity;
  for (const [tx, ty] of tentPx) for (const [px, py] of pinPx) min = Math.min(min, (tx - px) ** 2 + (ty - py) ** 2);
  return (Math.sqrt(min) * 16) / 256;
}

// The notification icon is tinted by alpha, so the pin must stay apart from the tent: with the mark centred at
// 80% of the canvas, a pixel in the gap under the pin is clear while the pin body and a tent leg are solid.
async function notificationIconProblems(rel) {
  const { data, info } = await sharp(root(rel)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (u, v) => {
    const s = (info.width * 0.8) / 248;
    const x = Math.round(info.width / 2 + (u - 256) * s);
    const y = Math.round(info.height / 2 + (v - 252) * s);
    return data[(y * info.width + x) * 4 + 3];
  };
  const problems = [];
  if (alphaAt(256, 291) > 16) problems.push(`${rel}: the pin touches the tent (no gap under the pin)`);
  if (alphaAt(256, 215) < 240) problems.push(`${rel}: the pin body is not solid`);
  if (alphaAt(170, 350) < 240) problems.push(`${rel}: the tent leg is not solid`);
  return problems;
}

const check = process.argv.includes('--check');
const errors = [];
for (const file of FILES) {
  const m = await measure(file);
  const pct = (v, size) => ((100 * v) / size).toFixed(1);
  const [x0, y0, x1, y1] = m.bbox;
  console.log(`${m.rel} ${m.w}x${m.h}`);
  console.log(`  mark bbox x ${pct(x0, m.w)}-${pct(x1, m.w)}%  y ${pct(y0, m.h)}-${pct(y1, m.h)}%  (width ${pct(x1 - x0, m.w)}%, height ${pct(y1 - y0, m.h)}%)`);
  console.log(`  farthest mark pixel from centre: ${m.farthestPct.toFixed(1)}% of canvas diameter${m.safe ? `  (limit ${(100 * m.safe).toFixed(1)}%)` : ''}`);
  console.log(`  corners (RGBA): ${m.corners.map((c) => `(${c.join(',')})`).join(' ')}`);
  if (!check) continue;
  if (m.kind !== 'layer') {
    const want = m.rel.includes('daylight') ? daylight : stage;
    for (const c of m.corners) if (c[3] !== 255 || want.some((v, i) => v !== c[i])) errors.push(`${m.rel}: corner (${c.join(',')}) is not ground rgb(${want.join(',')})`);
  }
  if (m.safe && m.farthestPct > 100 * m.safe) (m.advisory ? console.warn : errors.push.bind(errors))(`${m.rel}: ${m.advisory ? 'WARN (advisory until the Android 12 emulator check) ' : ''}mark reaches ${m.farthestPct.toFixed(1)}% of the canvas diameter, limit ${(100 * m.safe).toFixed(1)}%`);
}
if (check) errors.push(...(await notificationIconProblems('packages/mobile/assets/notification-icon.png')));
for (const rel of ['docs/brand/festie-favicon.svg', 'docs/brand/festie-favicon-daylight.svg', 'packages/web/public/favicon.svg', 'packages/web/public/favicon-daylight.svg']) {
  const gap = await faviconGapAt16(rel);
  console.log(`${rel}
  pin to tent gap in a 16 px render: ${gap.toFixed(2)} px`);
  if (check && gap < 2) errors.push(`${rel}: pin to tent gap is ${gap.toFixed(2)} px at 16 px, need at least 2`);
}
if (check) {
  if (errors.length) {
    console.error(`measure-brand-rasters: ${errors.length} problem(s)\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('measure-brand-rasters: ok');
}
