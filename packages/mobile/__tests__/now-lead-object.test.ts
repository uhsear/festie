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

describe('Now & Next live handoff (DP-50)', () => {
  it('fades the card in at the medium duration, gated by Reduce Motion', () => {
    const src = read('components/SetChangeEnter.tsx');
    expect(src).toContain('FadeIn.duration(motionDuration.med)');
    expect(src).toMatch(/if \(reduceMotion\) return <>\{children\}<\/>/);
  });
  it('keys each card by set id so a set change replays the entrance', () => {
    expect(read('components/NowSurface.tsx')).toContain('<SetChangeEnter key={set.id}>');
    expect(read('components/NowSurface.tsx')).toContain('<SetChangeEnter key={next.set.id}>');
    expect(read('components/NowNextStrip.tsx')).toContain('<SetChangeEnter key={focus.set.id}>');
  });
});

describe('Now & Next strip concurrent live sets', () => {
  const src = read('components/NowNextStrip.tsx');
  it('leads with one set and folds the rest into a count', () => {
    expect(src).toContain('const nowSet = current[0];');
    expect(src).toContain('`+${current.length - 1} more live`');
    expect(src).toContain('testID="now-next-more"');
  });
  it('announces the count in the accessibility label', () => {
    expect(src).toContain("${moreLabel ? ` ${moreLabel}.` : ''} Open Now & Next.");
  });
});
