import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const dirs = ['packages/web/src', 'packages/mobile/app', 'packages/mobile/components', 'packages/mobile/lib'];
const skipDir = new Set(['node_modules', 'dist', '__tests__']);
const banned = [
  'Logout', 'Sign Up Free', 'Create Account', 'Sign Out', 'Log in to', 'Time conflict',
  'You have a conflict', 'Enter Festival Mode', 'Find each other', 'My Picks', 'Share plan',
  'Tap the diamond', 'Festival wrap', "'LIVE'",
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!skipDir.has(name)) yield* walk(full);
    } else if (/\.tsx?$/.test(name) && !/\.(test|stories)\./.test(name)) {
      yield full;
    }
  }
}

test('UI source avoids retired vocabulary', () => {
  const hits: string[] = [];
  for (const d of dirs) {
    for (const file of walk(join(root, d))) {
      // shortcut: a `//` inside a string is also stripped, fine for this phrase list; revisit if a banned phrase follows a URL.
      const text = readFileSync(file, 'utf8').replace(/\r/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/^.*console\.\w+\(.*$/gm, '');
      for (const phrase of banned) {
        if (new RegExp(`(?<![A-Za-z])${phrase}(?![A-Za-z])`).test(text)) hits.push(`${relative(root, file)}: ${phrase}`);
      }
    }
  }
  assert.deepEqual(
    hits,
    [],
    `Retired phrases found:\n${hits.join('\n')}\nUse the word from docs/design/copy-voice.md (COPY in @festie/shared).`,
  );
});
