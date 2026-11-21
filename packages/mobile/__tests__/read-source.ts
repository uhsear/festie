import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

/**
 * Screens split into a route file plus parts under a components folder. The
 * route keeps the screen's state; its markup lives in the parts, so a
 * source-text guard about the screen must read both.
 */
const SPLIT_SCREENS: Record<string, string> = {
  'app/(tabs)/crew.tsx': 'components/crew',
};

/**
 * Reads a file under packages/mobile as UTF-8 text, for source-text guards. For a
 * split screen it returns the route file followed by every part file.
 */
export const read = (rel: string) => {
  const main = readFileSync(join(root, rel), 'utf8');
  const dir = SPLIT_SCREENS[rel];
  if (!dir) return main;
  const parts = readdirSync(join(root, dir))
    .sort()
    .map((name) => readFileSync(join(root, dir, name), 'utf8'));
  return [main, ...parts].join('\n');
};
