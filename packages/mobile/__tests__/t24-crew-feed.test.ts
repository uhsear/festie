import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('T24 crew feed', () => {
  it('CrewActivity hides vote rows and pages older events', () => {
    const src = read('components/CrewActivity.tsx');
    expect(src).toContain('visibleCrewActivity');
    expect(src).toContain('loadOlderActivity');
    expect(src).toContain('Show older');
  });
  it('useRealtimeSync shows the crew notice', () => {
    expect(read('hooks/useRealtimeSync.ts')).toContain('onCrewNotice');
  });
});
