import { describe, it, expect } from 'vitest';
import { read } from './read-source';

describe('Now & Next lead object (DP-37)', () => {
  const src = read('components/NowSurface.tsx');
  it('draws the set name at display-lg and the countdown at display-xl, tabular', () => {
    expect(src).toContain("artist: { ...typeStyle('display-lg')");
    expect(src).toContain("typeStyle('display-xl', undefined, { tabular: true })");
  });
  it('counts down before the festival and shows a Wrap thumbnail after it', () => {
    expect(src).toContain("typeStyle('display-lg', undefined, { tabular: true })");
    expect(src).toContain('<WrapThumb festivalName={festivalName} />');
  });
  it('never prints the festival name inside the hero', () => {
    expect(src).not.toMatch(/<Text[^>]*>\s*\{festivalName\}/);
  });
});
