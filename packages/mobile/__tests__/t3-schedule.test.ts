import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t3 schedule and picks list source guards', () => {
  it('schedule keeps the lineup when switching festivals', () => {
    const src = read('app/(tabs)/index.tsx');
    expect(src).not.toContain('clearSelection');
    expect(src).not.toMatch(/sets:\s*\[\]/);
  });

  it('schedule searches other days and offers another day', () => {
    const src = read('app/(tabs)/index.tsx');
    expect(src).toContain('searchOtherDays');
    expect(src).toContain("label: 'Show another day'");
  });

  it('schedule search blames the filters when they hide a selected-day match', () => {
    expect(read('app/(tabs)/index.tsx')).toContain('searchHiddenByFilters(');
  });

  it('SetCardMobile announces a saving or queued pick', () => {
    const src = read('components/SetCardMobile.tsx');
    expect(src).toContain('waiting to sync');
    expect(src).toContain("'waiting to sync' : 'saving'");
  });

  it('FestivalList reports a finished selection', () => {
    expect(read('components/FestivalList.tsx')).toContain('onSelected');
  });

  it('no pick save or remove is swallowed silently', () => {
    const files = [
      'app/(tabs)/index.tsx',
      'app/(tabs)/picks.tsx',
      'components/FestivalList.tsx',
      'components/SetCardMobile.tsx',
      'components/CrewSuggestionStrip.tsx',
    ];
    for (const file of files) {
      expect(read(file), file).not.toMatch(/(savePick|removePick)\([^)]*\)\.catch\(\(\) => \{\}\)/);
    }
  });
});
