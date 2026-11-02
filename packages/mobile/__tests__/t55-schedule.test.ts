import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t55 mobile schedule', () => {
  const chip = read('components/ClashChip.tsx');
  it('ClashChip navigates to Picks itself and shows No clashes', () => {
    expect(chip).toContain('COPY.clash.none');
    expect(chip).toContain("show: 'clashes'");
    expect(chip).toContain('/(tabs)/picks');
    expect(chip).not.toMatch(/interface ClashChipProps \{[^}]*onPress/);
  });
  it('index and grid wire View as and clear it with the other filters', () => {
    for (const rel of ['app/(tabs)/index.tsx', 'app/grid.tsx']) {
      const src = read(rel);
      expect(src).toContain('useViewAs(');
      expect(src).toMatch(/clearAllFilters = [\s\S]*?viewAs\.clear\(\)/);
    }
  });
  it('Timeline and grid pass picked and drop the jump-to-clash code', () => {
    for (const rel of ['components/TimelineView.tsx', 'app/grid.tsx']) {
      const src = read(rel);
      expect(src).toContain('picked=');
      expect(src).not.toContain('pickClashTarget');
      expect(src).not.toContain('showFirstClash');
    }
  });
  it('picks reads show and announces the clash count', () => {
    const src = read('app/(tabs)/picks.tsx');
    expect(src).toContain('useLocalSearchParams');
    expect(src).toContain('announceForAccessibility');
  });
});
