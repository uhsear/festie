import { describe, expect, it } from 'vitest';
import type { FestivalDay, FestivalSet, LineupEntry, Stage } from '@festie/shared/types';
import {
  LINEUP_VIEW_KEY,
  interestedRows,
  markedWithoutSet,
  splitBySeries,
  type LineupCover,
} from '@festie/shared/utils';
import { read } from './read-source';

const entry = (id: string, name: string): LineupEntry => ({
  id,
  artists: [{ name, links: {} }],
  displayName: null,
  tier: null,
  dayDate: null,
  status: 'announced',
  announcedAt: '2026-11-20',
  linkedSetIds: [],
});

describe('Picks tab: "Marked, no set yet"', () => {
  const lineup = [entry('lu-a', 'Alpha'), entry('lu-b', 'Beta')];
  const cover: Record<string, LineupCover> = {
    'lu-a': { setIds: [], state: 'announced', dayIndex: -1 },
    'lu-b': { setIds: ['s1'], state: 'scheduled', dayIndex: 0 },
  };
  const sets = [{ id: 's1', stageId: 'main', artist: 'Beta', dayIndex: 0, startTime: '22:00' }] as FestivalSet[];
  const days = [{ date: '2099-02-05', label: 'Fri' }] as FestivalDay[];
  const stages = [{ id: 'main', name: 'Main Stage' }] as Stage[];

  it('lists a marked act that no set covers, and not one that has a set', () => {
    const rows = interestedRows({
      lineup,
      marks: { 'lu-a': { state: 'open' }, 'lu-b': { state: 'open' } },
      cover,
      picks: {},
      sets,
      days,
      stages,
    });
    expect(markedWithoutSet(rows).map((r) => r.entry.id)).toEqual(['lu-a']);
  });

  it('the mobile Picks screen renders the group from the shared rows', () => {
    expect(read('app/(tabs)/picks.tsx')).toContain('<MarkedNoSet />');
    const group = read('components/MarkedNoSet.tsx');
    expect(group).toContain('markedWithoutSet(useInterestedRows())');
    expect(group).toContain('Marked, no set yet');
  });
});

describe('shared load state and chips', () => {
  it('the picks tab reads the shared festivalLoadState, as the other festival screens do', () => {
    expect(read('app/(tabs)/picks.tsx')).toContain('festivalLoadState(');
  });

  it('the picks cold-start load reads the load flags at fire time, so an empty catalogue cannot loop', () => {
    const picks = read('app/(tabs)/picks.tsx');
    expect(picks).toContain('useFestivalDataStore.getState()');
    expect(picks).toContain('}, [currentFestival, festivals.length, loadFestivals]);');
  });

  it('the grid shows the schedule freshness chip', () => {
    const grid = read('app/grid.tsx');
    expect(grid).toContain("import FreshnessChip from '../components/FreshnessChip';");
    expect(grid).toContain('<FreshnessChip surface="schedule" />');
  });
});

describe('one lineup view key and hook', () => {
  it('both apps use the shared key and the shared hook', () => {
    expect(LINEUP_VIEW_KEY).toBe('festie.lineupView');
    expect(read('components/AnnouncedLineup.tsx')).not.toContain("'festie.lineupView'");
    expect(read('components/AnnouncedLineup.tsx')).toContain('LINEUP_VIEW_KEY');
    expect(read('app/grid.tsx')).toContain("import { useAnnouncedLineup } from '@festie/shared/hooks/useAnnouncedLineup';");
  });
});

describe('festival picker series', () => {
  it('FK 2026 and FK 2027 land in one series block, newest first', () => {
    const { series, standalone } = splitBySeries([
      { id: 'fk-2026', name: 'Forbidden Kingdom 2026', startDate: '2026-08-01' },
      { id: 'nc-2026', name: 'North Coast 2026', startDate: '2026-09-01' },
      { id: 'fk-2027', name: 'Forbidden Kingdom 2027', startDate: '2027-08-01' },
    ]);
    expect(series.map((s) => [s.label, s.editions.map((f) => f.id)])).toEqual([
      ['Forbidden Kingdom', ['fk-2027', 'fk-2026']],
    ]);
    expect(standalone.map((f) => f.id)).toEqual(['nc-2026']);
  });

  it('the mobile list renders the series block', () => {
    const list = read('components/FestivalList.tsx');
    expect(list).toContain('splitBySeries(');
    expect(list).toContain("kind: 'series'");
    expect(list).toContain('partitionSeriesBlocks(');
    expect(list).toContain('Other festivals');
  });
});

describe('stale comments', () => {
  it('no TODO(expo-battery) is left, because mobile passes battery data', () => {
    expect(read('../shared/src/hooks/useLiveLocationPublisher.ts')).not.toContain('TODO(expo-battery)');
    expect(read('lib/backgroundShare.ts')).toContain('Battery.getBatteryLevelAsync');
  });

  it('the privacy screen header names the same effective date as EFFECTIVE_DATE', () => {
    const privacy = read('app/privacy.tsx');
    const date = /const EFFECTIVE_DATE = '([^']+)';/.exec(privacy)?.[1];
    expect(date).toBeTruthy();
    expect(privacy).toContain(`(effective ${date})`);
  });
});
