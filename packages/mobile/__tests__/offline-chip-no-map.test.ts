import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'components/OfflineStatusChip.tsx'), 'utf8').split(String.fromCharCode(13)).join('');

describe('OfflineStatusChip on an unmapped festival', () => {
  it('words the offer as saving the schedule, not downloading, when there is no map', () => {
    expect(src).toContain('offlineStatusLabel(summary, undefined, hasMap)');
  });
});
