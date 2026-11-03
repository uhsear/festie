/**
 * Every activity type a route writes needs a feed label, or the feed shows a raw code.
 * No database: reads route and config sources as text.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Push types share the `type:` key but never reach the feed.
const PUSH_TYPES = new Set(['crew_sos', 'crew_update']);

describe('crew activity labels', () => {
  it('has a CREW_ACTIVITY_LABELS key for every activity type routes write', () => {
    const routesDir = path.join(root, 'routes');
    const written = new Set<string>();
    for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(routesDir, file), 'utf8');
      if (!/activity/i.test(src)) continue;
      for (const m of src.matchAll(/\btype:\s*'([^']+)'/g)) written.add(m[1]!);
    }
    for (const t of PUSH_TYPES) written.delete(t);

    const config = fs.readFileSync(path.join(root, 'packages/shared/src/constants/config.ts'), 'utf8');
    const block = config.slice(config.indexOf('export const CREW_ACTIVITY_LABELS'));
    const labels = block.slice(0, block.indexOf('};'));
    const missing = [...written].filter((t) => !labels.includes(`'${t}':`) && !labels.includes(` ${t}:`));
    assert.deepEqual(missing, [], `Add these to CREW_ACTIVITY_LABELS: ${missing.join(', ')}`);
  });
});
