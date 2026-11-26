/**
 * gen-design-md — rewrites the generated frontmatter sections (colors,
 * typography, rounded, spacing) of packages/web/DESIGN.md and
 * packages/mobile/DESIGN.md from the @festie/shared TS tokens.
 *
 * Run: pnpm --filter @festie/shared gen:design
 *
 * DESIGN.md is gitignored, so a checkout without it skips that file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { applyDesignFrontmatter, type DesignPlatform } from '../src/tokens/generateDesignMd.js';

const here = dirname(fileURLToPath(import.meta.url));

for (const platform of ['web', 'mobile'] as DesignPlatform[]) {
  const path = resolve(here, `../../${platform}/DESIGN.md`);
  if (!existsSync(path)) {
    // eslint-disable-next-line no-console
    console.log(`[gen-design-md] skipped ${path} (not present)`);
    continue;
  }
  writeFileSync(path, applyDesignFrontmatter(readFileSync(path, 'utf8'), platform), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[gen-design-md] wrote ${path}`);
}
