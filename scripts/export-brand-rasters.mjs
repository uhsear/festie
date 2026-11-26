#!/usr/bin/env node
/**
 * export-brand-rasters.mjs: regenerates the icon rasters from the master SVGs in docs/brand so they sit on
 * the token ground (bg.primary). Run it after changing a master or the ground, then run
 * `node scripts/measure-brand-rasters.mjs --check`. The splash icons, the notification icon and the OG image
 * are not touched here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const ground = /bg:\s*\{\s*primary:\s*'(#[0-9a-f]{6})'/i.exec(readFileSync(root('packages/shared/src/tokens/colors.ts'), 'utf8'))[1];
const markSvg = readFileSync(root('docs/brand/festie-mark.svg'), 'utf8');
const [tent, pin] = markSvg.match(/<path[^>]*\/>/g);
// The mark's art spans x 132-380 and y 132-372 inside its 512 unit viewBox.
const ART = { cx: 256, cy: 252, width: 248 };

/** The mark with its art `widthPct` of the canvas wide, centred, on `bg` (null = transparent). `mono` paints both shapes one colour. */
function mark(size, widthPct, { bg = null, mono = null } = {}) {
  const side = ART.width / widthPct;
  const paint = (p) => (mono ? p.replace(/fill="#[0-9a-f]{6}"/i, `fill="${mono}"`) : p);
  const rect = bg ? `<rect x="-1000" y="-1000" width="3000" height="3000" fill="${bg}"/>` : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${ART.cx - side / 2} ${ART.cy - side / 2} ${side} ${side}">${rect}${paint(tent)}${paint(pin)}</svg>`);
}

// The email lockup is 64 px tall, 2x of its 32 px display height. Foreground and monochrome marks sit at 43.6% so the farthest tent corner stays inside the 66 of 108 dp safe circle.
const jobs = [
  [mark(180, 0.7, { bg: ground }), 'packages/web/public/apple-touch-icon.png'],
  [mark(192, 0.7, { bg: ground }), 'packages/web/public/icons/icon-192.png'],
  [mark(512, 0.7, { bg: ground }), 'packages/web/public/icons/icon-512.png'],
  [mark(512, 0.531, { bg: ground }), 'packages/web/public/icons/icon-maskable-512.png'],
  [mark(1024, 0.619, { bg: ground }), 'packages/mobile/assets/icon.png'],
  [mark(1024, 0.436), 'packages/mobile/assets/android-icon-foreground.png'],
  [mark(1024, 0.436, { mono: '#ffffff' }), 'packages/mobile/assets/android-icon-monochrome.png'],
  [Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${ground}"/></svg>`), 'packages/mobile/assets/android-icon-background.png'],
  [readFileSync(root('docs/brand/festie-favicon.svg')), 'packages/mobile/assets/favicon.png', 48],
  [readFileSync(root('docs/brand/festie-lockup.svg')), 'public/icons/email-lockup.png', null, 64 / 199],
];
for (const [svg, rel, size, scale] of jobs) {
  let img = sharp(svg, { density: size ? 384 : 72 });
  if (size) img = img.resize(size, size);
  if (scale) img = sharp(svg, { density: 72 * scale });
  await img.png({ compressionLevel: 9 }).toFile(root(rel));
}

// favicon.ico: PNG frames at 16, 32 and 48 px, rendered from the simplified favicon master.
const faviconSvg = readFileSync(root('docs/brand/festie-favicon.svg'));
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map((s) => sharp(faviconSvg, { density: 1536 }).resize(s, s).png({ compressionLevel: 9 }).toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const at = 6 + 16 * i;
  header[at] = s; header[at + 1] = s; // width, height
  header.writeUInt16LE(1, at + 4); // colour planes
  header.writeUInt16LE(32, at + 6); // bits per pixel
  header.writeUInt32LE(frames[i].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += frames[i].length;
});
writeFileSync(root('packages/web/public/favicon.ico'), Buffer.concat([header, ...frames]));
console.log('export-brand-rasters: wrote', jobs.length + 1, 'files');
