import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('crew tab states', () => {
  it('uses useActiveCrew and the error copy', () => {
    const src = read('app/(tabs)/crew.tsx');
    expect(src).toContain('useActiveCrew(');
    expect(src).toContain("Couldn't load your crew");
    expect(src).not.toContain('selectCrew(crews[0]!.id)');
  });
  it('shows the offline-join state instead of the load error', () => {
    expect(read('app/(tabs)/crew.tsx')).toContain("Joining when you're back online");
  });
  it('announces a queued home base save', () => {
    const src = read('components/CrewHomeBase.tsx');
    expect(src).toContain("outcome === 'queued'");
    expect(src).toContain('announceForAccessibility(QUEUED_WRITE_MESSAGE)');
  });
  it('blocks the settle button while the write is in flight', () => {
    const src = read('components/CrewExpenses.tsx');
    expect(src).toContain('setSettling(true)');
    expect(src).toContain('settlingRef.current = true');
    expect(src).toContain('settlingRef.current = false');
    expect(src).toContain('setSettling(false)');
    expect(src).toContain('disabled={settling}');
  });
  it('crewFestival re-exports the shared helper', () => {
    expect(read('lib/crewFestival.ts')).toContain("from '@festie/shared/utils'");
  });
});
