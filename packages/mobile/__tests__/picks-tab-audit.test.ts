import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const picks = read('app/(tabs)/picks.tsx');

describe('picks tab audit guards', () => {
  it('My day membership ignores collapsed groups and keeps no-day picks', () => {
    const start = picks.indexOf('if (!myDayMode) return rows;');
    const end = picks.indexOf('}, [\n    activePlanList,', start);
    const branch = picks.slice(start, end);
    expect(branch).toContain('buildPicksRows(');
    expect(branch).toContain('collapsed: new Set()');
    expect(branch).not.toMatch(/of rows\)/);
    expect(branch).toContain("groupId: 'myday-tba'");
    expect(branch).toContain('isSetScheduled');
  });

  it('signed-in user without a profile reaches the list, not a dead-end empty state', () => {
    expect(picks).not.toContain('user && !currentProfile');
  });

  it('group and order controls leave an open plan list', () => {
    expect(picks).toMatch(/setPlanList\(null\);\s*setMyDayMode/);
    expect(picks).toMatch(/setPlanList\(null\);\s*setOrder\(next\)/);
    expect(picks).toContain('stats.total > 0 && !myDayMode');
  });

  it('closing search clears the query; list dismisses keyboard on drag', () => {
    expect(picks).toContain("if (searchOpen) setSearch('')");
    expect(picks).toContain('keyboardDismissMode="on-drag"');
  });

  it('long names are not clipped to one line', () => {
    expect(picks).toMatch(/styles\.listenName\} numberOfLines=\{2\}/);
    const clash = read('components/ClashCards.tsx');
    expect(clash).not.toContain('numberOfLines={1}');
    const rows = read('components/PlanRows.tsx');
    expect(rows).toContain('artistDisplayName(item.set, b2bSeparator)');
    expect(picks).toContain('b2bSeparator={separator}');
  });

  it('banners do not double-inset inside listContent', () => {
    expect(read('components/RateNightBanner.tsx')).not.toContain('marginHorizontal');
    expect(read('components/LockscreenStaleBanner.tsx')).not.toContain('marginHorizontal');
  });

  it('bulk panel text is font-scale capped and header can shrink', () => {
    expect(picks).toMatch(/bulkHeaderText\} maxFontSizeMultiplier/);
    expect(picks).toMatch(/bulkHeaderText: \{[^}]*flexShrink: 1/);
    expect(picks).not.toMatch(/<Text style=\{styles\.bulkSubLabel\}>/);
  });
});
