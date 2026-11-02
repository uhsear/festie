import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t26 mobile status and Home Base source guards', () => {
  it('CrewStatus uses presets, expiry and auto-arrive', () => {
    const src = read('components/CrewStatus.tsx');
    expect(src).toContain('useAutoArrive(');
    expect(src).toContain('isStatusFresh(');
    expect(src).toContain('CREW_STATUS_PRESETS');
    expect(src).not.toContain('STATUS_OPTIONS');
  });
  it('CrewHomeBase can remove Home Base', () => {
    const src = read('components/CrewHomeBase.tsx');
    expect(src).toContain('Remove Home Base');
    expect(src).toContain('location: null, time: null');
  });
});
