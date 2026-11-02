import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard for the T19 competitor-study addendum: every set row shows start - end, not the start alone.
const SRC_ROOT = resolve(__dirname, '..');
// T20 moved the My Picks row into PicksPlanRow.
const ROWS = ['components/features/SetCard.tsx', 'components/features/PicksPlanRow.tsx', 'routes/crew-plan.tsx'];

describe('set rows show start - end', () => {
  it.each(ROWS)('%s formats its row time with formatSetTimeRange', (rel) => {
    expect(readFileSync(resolve(SRC_ROOT, rel), 'utf8')).toContain('formatSetTimeRange(');
  });
});
