import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

/**
 * Screens split into a route file plus parts. The route keeps the screen's
 * state; its markup and extracted hooks live in the parts (a folder, or one
 * file), so a source-text guard about the screen must read all of them.
 */
const SPLIT_SCREENS: Record<string, string[]> = {
  'app/(tabs)/crew.tsx': ['components/crew'],
  'app/(tabs)/index.tsx': ['components/schedule'],
  'app/(tabs)/picks.tsx': ['components/picks', 'hooks/usePicksCalendar.ts'],
  'app/admin/festival-edit.tsx': ['components/admin/festival-edit'],
};

const readPart = (rel: string): string[] =>
  statSync(join(root, rel)).isDirectory()
    ? readdirSync(join(root, rel))
        .sort()
        .map((name) => readFileSync(join(root, rel, name), 'utf8'))
    : [readFileSync(join(root, rel), 'utf8')];

/**
 * Reads a file under packages/mobile as UTF-8 text, for source-text guards. For a
 * split screen it returns the route file followed by every part file.
 */
export const read = (rel: string) => {
  const main = readFileSync(join(root, rel), 'utf8');
  const parts = (SPLIT_SCREENS[rel] ?? []).flatMap(readPart);
  return [main, ...parts].join('\n');
};
