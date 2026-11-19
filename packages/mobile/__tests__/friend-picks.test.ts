import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const screen = readFileSync(join(__dirname, '..', 'app', 'friend-picks.tsx'), 'utf8');

describe('T38 mobile friend picks', () => {
  it('uses the shared compare and add helpers', () => {
    for (const name of [
      'parseSharedPicksRef',
      'compareSharedPicks',
      'planSharedPicksAdd',
      'bulkSavePicks',
      'restorePicks',
    ]) {
      expect(screen).toContain(name);
    }
  });

  it('reads through the shared service, not fetch', () => {
    expect(screen).toContain('fetchSharedPicks');
    expect(screen).not.toContain('fetch(');
  });
});
