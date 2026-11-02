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
  it('crewFestival re-exports the shared helper', () => {
    expect(read('lib/crewFestival.ts')).toContain("from '@festie/shared/utils'");
  });
});
