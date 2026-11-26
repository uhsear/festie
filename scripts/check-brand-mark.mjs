// Rasterises docs/brand/festie-mark.svg at 512 px and checks the pin/tent junction:
// no pixel is painted by both shapes, and every tent pixel near the pin keeps the 10-unit gap.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const svg = readFileSync(new URL('../docs/brand/festie-mark.svg', import.meta.url), 'utf8');
const paths = svg.match(/<path[^>]*\/>/g);
if (paths?.length !== 2) throw new Error('festie-mark.svg must hold exactly the tent path and the pin path');

async function alphaOf(path) {
  const body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${path}</svg>`;
  const { data, info } = await sharp(Buffer.from(body)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return (x, y) => data[(y * info.width + x) * info.channels + 3] > 127;
}
const tent = await alphaOf(paths[0]);
const pin = await alphaOf(paths[1]);

const pinPixels = [];
for (let y = 150; y < 300; y++) for (let x = 190; x < 322; x++) if (pin(x, y)) pinPixels.push([x, y]);
let overlap = 0;
let minGap = Infinity;
for (let y = 220; y < 310; y++) {
  for (let x = 200; x < 312; x++) {
    if (!tent(x, y)) continue;
    if (pin(x, y)) overlap++;
    for (const [px, py] of pinPixels) minGap = Math.min(minGap, Math.hypot(px - x, py - y));
  }
}
console.log(`junction overlap pixels: ${overlap}, smallest tent-to-pin gap: ${minGap.toFixed(2)} px`);
if (overlap > 0 || minGap < 9) {
  console.error('Mark junction is wrong: tent touches the pin.');
  process.exit(1);
}
