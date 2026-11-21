import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FestivalSet } from '@festie/shared/types';
import { useArtistSheetStore } from '@festie/shared/stores/artistSheetStore';
import { artistNameSegments } from '@festie/shared/utils/artistSheet';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const set = (over: Partial<FestivalSet>): FestivalSet => ({
  id: 's1',
  festivalId: 'f',
  stageId: 'st',
  startTime: '',
  endTime: '',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('artist names open the shared artist sheet', () => {
  it('a set without times and a timed set both resolve to one target per artist', () => {
    const untimed = artistNameSegments(set({ artists: [{ name: 'Ana' }, { name: 'Bo' }] }));
    const timed = artistNameSegments(set({ artists: [{ name: 'Ana' }, { name: 'Bo' }], startTime: '20:00', endTime: '21:00' }));
    expect(untimed.map((s) => s.target.title)).toEqual(['Ana', 'Bo']);
    expect(timed).toEqual(untimed);
  });

  it('opening a target shows it and closing keeps it for the exit animation', () => {
    const [seg] = artistNameSegments(set({ artist: 'Solo' }));
    useArtistSheetStore.getState().open(seg!.target);
    expect(useArtistSheetStore.getState()).toMatchObject({ isOpen: true, target: { title: 'Solo' } });
    useArtistSheetStore.getState().close();
    expect(useArtistSheetStore.getState()).toMatchObject({ isOpen: false, target: { title: 'Solo' } });
  });

  it('the root layout mounts the one host', () => {
    expect(read('app/_layout.tsx')).toContain('<ArtistSheetHost />');
  });

  it.each([
    'components/SetCardMobile.tsx',
    'components/TimelineView.tsx',
    'components/PlanRows.tsx',
    'components/CrewSuggestionStrip.tsx',
    'components/NowNextStrip.tsx',
    'components/DiscoverRow.tsx',
    'components/TBASection.tsx',
    'components/CaughtNowCard.tsx',
    'components/AlsoPickedSection.tsx',
    'components/OtherDayMatches.tsx',
    'components/SetContextSection.tsx',
    'components/CrewCompareSummary.tsx',
    'components/AnnouncedLineup.tsx',
    'components/AccountHistorySection.tsx',
    'app/grid.tsx',
    'app/crew-compare.tsx',
    'app/crew-plan.tsx',
    'app/friend-picks.tsx',
    'app/caught.tsx',
    'app/rate.tsx',
  ])('%s renders artist names through ArtistName', (file) => {
    expect(read(file)).toMatch(/ArtistName(Runs|Button|Inline)?\b/);
  });

  it('the set card keeps the name button and the body halves as siblings', () => {
    const card = read('components/SetCardMobile.tsx');
    expect(card).toContain('<ArtistName');
    expect(card).toContain('importantForAccessibility="no-hide-descendants"');
  });
});
