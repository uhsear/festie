import { describe, it, expect } from 'vitest';
import { read } from './read-source';


describe('t11 day-of source guards', () => {
  it('CrewHomeBase no longer disables the card for members', () => {
    expect(read('components/CrewHomeBase.tsx')).not.toContain('disabled={!isOwner}');
  });
  it('NowSurface crew list expands', () => {
    expect(read('components/NowSurface.tsx')).toContain('Show fewer');
  });
});
