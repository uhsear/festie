/** The CSP sets script-src-attr 'none', so an inline on*= handler in a static page silently does nothing. */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');

describe('public/*.html', () => {
  for (const file of readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html'))) {
    test(`${file} has no inline event handlers`, () => {
      const html = readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
      assert.doesNotMatch(html, /<[a-z][^>]*\son[a-z]+\s*=/i);
    });
  }
});
