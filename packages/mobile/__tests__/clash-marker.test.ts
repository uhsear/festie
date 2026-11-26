import { read } from './read-source';

describe('one clash marker (DP-44)', () => {
  const clashFiles = [
    'components/ClashChip.tsx',
    'components/ClashCards.tsx',
    'components/ClashPrompt.tsx',
    'components/TimelineView.tsx',
    'app/grid.tsx',
    'components/SetCardMobile.tsx',
  ];

  it('draws no warning icon for a clash', () => {
    for (const file of clashFiles) {
      const src = read(file);
      const clashIcons = src.split('\n').filter((l) => /Ionicons name="(warning|warning-outline)"/.test(l) && /clash/.test(l));
      expect(clashIcons, file).toEqual([]);
    }
  });

  it('shows the minutes numeral on the grid and timeline blocks and drops the duplicate outline', () => {
    for (const file of ['components/TimelineView.tsx', 'app/grid.tsx']) {
      const src = read(file);
      expect(src, file).toContain('clashMinutes(mark.overlapMin)');
      expect(src, file).not.toMatch(/borderColor: (mark \?|t\.colors\.clash)/);
    }
  });

  it('exports the swatch from ClashHatch', () => {
    expect(read('components/ClashHatch.tsx')).toContain('export function ClashSwatch');
  });
});
