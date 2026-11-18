/**
 * Artists store behavior that needs no database: a paste of many names reads the festival data once.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createArtistsStore } from '../lib/db/stores/artists';
import { artistNameKey } from '../lib/artist-key';

describe('artists.match', () => {
  test('a paste of many names scans festival data once, not once per name', async () => {
    const statements: string[] = [];
    const pool = {
      query: async (sql: string, params: unknown[][]) => {
        statements.push(sql);
        if (sql.includes('FROM artists')) {
          return {
            rows: (params[0] as string[]).map((key) => ({
              id: `art-${key}`,
              name: key,
              name_key: key,
              label: '',
              spotify_id: null,
              links: {},
              photo: null,
              genres: [],
              merged_into: null,
              updated_at: new Date(),
            })),
          };
        }
        return { rows: [] };
      },
    };
    const names = Array.from({ length: 40 }, (_, i) => `Match Name ${i}`);
    const results = await createArtistsStore(pool as any).match(names.map((name) => ({ name })));
    assert.equal(results.length, 40);
    assert.ok(results.every((r, i) => r.outcome === 'linked' && r.candidates[0]!.id === `art-${artistNameKey(names[i]!)}`));
    assert.equal(statements.length, 2, statements.join('\n---\n'));
    assert.equal(statements.filter((sql) => sql.includes('festival_sets')).length, 1);
  });
});
