import { describe, expect, it } from 'vitest';
import { colors, colorsDaylight } from '../tokens';
import { GHOST_ROWS, resolveGhostToken, type GhostRowKind } from './ghostRows';
import { PRIORITY_OPTIONS } from './config';

describe('GHOST_ROWS', () => {
  it('has a row for picks, crew and inbox', () => {
    expect(Object.keys(GHOST_ROWS).sort()).toEqual(['crew', 'inbox', 'picks']);
  });

  it('shows the real pick priority labels on the picks row', () => {
    expect(GHOST_ROWS.picks.pills).toEqual(PRIORITY_OPTIONS.map((p) => p.short));
  });

  it.each(Object.keys(GHOST_ROWS) as GhostRowKind[])('%s tokens resolve in both palettes', (kind) => {
    for (const path of Object.values(GHOST_ROWS[kind].tokens)) {
      expect(resolveGhostToken(colors, path)).toEqual(expect.any(String));
      expect(resolveGhostToken(colorsDaylight, path)).toEqual(expect.any(String));
    }
  });
});
