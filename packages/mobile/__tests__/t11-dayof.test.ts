import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t11 day-of source guards', () => {
  it('CrewHomeBase no longer disables the card for members', () => {
    expect(read('components/CrewHomeBase.tsx')).not.toContain('disabled={!isOwner}');
  });
  it('NowSurface crew list expands', () => {
    expect(read('components/NowSurface.tsx')).toContain('Show fewer');
  });
});
