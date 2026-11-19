import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Festival, FestivalDay, FestivalSet, LineupEntry } from '@festie/shared/types';
import { announcedLineupModel, lineupReplacesEmptyState } from '@festie/shared/utils';
import { parseLineupView } from '../lib/lineupView';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const entry = (id: string, name: string, over: Partial<LineupEntry> = {}): LineupEntry => ({
  id,
  artists: [{ name }],
  displayName: null,
  tier: null,
  dayDate: null,
  status: 'announced',
  announcedAt: '2026-11-01',
  linkedSetIds: [],
  ...over,
});

const festival = (lineup: LineupEntry[]): Festival =>
  ({
    id: 'f1',
    name: 'Names Only Fest',
    b2bSeparator: 'b2b',
    publishedAt: '2026-10-01T00:00:00.000Z',
    lineup,
  }) as unknown as Festival;

// Pinned before the 2099 fixture days so the model never depends on the wall clock.
const NOW = Date.parse('2099-04-20T12:00:00.000Z');

const DAYS = [
  { id: 'd1', label: 'Fri', date: '2099-04-24' },
  { id: 'd2', label: 'Sat', date: '2099-04-25' },
] as unknown as FestivalDay[];

describe('announced lineup on mobile: the shared rules the home screen renders', () => {
  it('a names-only festival shows the lineup in place of "No sets for this day"', () => {
    const model = announcedLineupModel(festival([entry('a', 'Alpha'), entry('b', 'Beta')]), DAYS, [], 0, NOW);
    expect(model.visible).toBe(true);
    expect(model.noSets).toBe(true);
    expect(model.summary.header).toBe('2 acts announced · Set times TBA');
    expect(model.selection.active.map((e) => e.id)).toEqual(['a', 'b']);
    expect(lineupReplacesEmptyState(model, '')).toBe(true);
  });

  it('a search keeps the empty state and lists the matches instead', () => {
    const model = announcedLineupModel(festival([entry('a', 'Alpha')]), DAYS, [], 0, NOW);
    expect(lineupReplacesEmptyState(model, 'alp')).toBe(false);
  });

  it('a festival without a lineup keeps the empty state', () => {
    const model = announcedLineupModel(festival([]), DAYS, [], 0, NOW);
    expect(model.visible).toBe(false);
    expect(lineupReplacesEmptyState(model, '')).toBe(false);
  });

  it('a day with sets keeps its sets and the lineup follows them', () => {
    const sets = [{ id: 's1', dayIndex: 0, artist: 'Gamma', artists: [{ name: 'Gamma' }] }] as unknown as FestivalSet[];
    const model = announcedLineupModel(festival([entry('a', 'Alpha')]), DAYS, sets, 0, NOW);
    expect(model.visible).toBe(true);
    expect(lineupReplacesEmptyState(model, '')).toBe(false);
  });
  it('a festival with no days and a names-only lineup shows the lineup, and without one shows no lineup', () => {
    const named = announcedLineupModel(festival([entry('a', 'Alpha')]), [], [], 0, NOW);
    expect(named.visible).toBe(true);
    expect(lineupReplacesEmptyState(named, '')).toBe(true);
    const bare = announcedLineupModel(festival([]), [], [], 0, NOW);
    expect(lineupReplacesEmptyState(bare, '')).toBe(false);
  });
});

describe('grid bottom panel rows', () => {
  it('a fully scheduled day with a lineup has no active or cancelled acts to list', () => {
    const sets = [{ id: 's1', dayIndex: 0, artist: 'Alpha', artists: [{ name: 'Alpha' }] }] as unknown as FestivalSet[];
    const lineup = [entry('a', 'Alpha', { linkedSetIds: ['s1'] })];
    const model = announcedLineupModel(festival(lineup), DAYS, sets, 0, NOW);
    expect(model.visible).toBe(true);
    expect(model.selection.active).toEqual([]);
    expect(model.selection.cancelled).toEqual([]);
  });
});

describe('lineupView helpers', () => {
  it('parseLineupView falls back to the Poster view', () => {
    expect(parseLineupView('az')).toBe('az');
    expect(parseLineupView('poster')).toBe('poster');
    expect(parseLineupView('nonsense')).toBe('poster');
    expect(parseLineupView(null)).toBe('poster');
    expect(parseLineupView(undefined)).toBe('poster');
  });
});

describe('announced lineup wiring (source guards)', () => {
  const home = read('app/(tabs)/index.tsx');
  const component = read('components/AnnouncedLineup.tsx');

  it('the home screen swaps the empty state in both views and moves the lineup under a search', () => {
    expect(home).toContain('const lineupStandsIn = lineupReplacesEmptyState(announced, searchQuery);');
    expect(home).toContain('lineupStandsIn ? undefined');
    expect(home).toContain('lineupStandsIn ? null');
    expect(home).toContain('{searchQuery.trim() ? null : <AnnouncedLineup model={announced} hPad={hPad} />}');
    expect(home).toContain('{searchQuery.trim() ? <AnnouncedLineup model={announced} /> : null}');
    expect(home).toContain('<AnnouncedLineup model={announced} hPad={hPad} />');
  });

  it('the component takes every rule from shared and imports only declared dependencies', () => {
    for (const fn of ['lineupEntryBadge', 'groupLineupByTier', 'groupLineupAlphabetically', 'searchLineupEntries', 'selectLineupEntries']) {
      expect(component).toContain(fn);
    }
    expect(component).toContain("from '@festie/shared/utils'");
    expect(component).not.toMatch(/from '@festie\/shared\/(?!stores|types|utils)/);
    expect(component).not.toContain('socket.io-client');
  });

  it('a tap on the view switch is not undone by a late saved-view read', () => {
    expect(component).toContain('if (!userChose.current) setView(parseLineupView(raw));');
    expect(component).toContain('userChose.current = true;');
  });

  it('a scheduled row opens its set and a cancelled one is struck through', () => {
    expect(component).toContain('router.push(`/set/${first.id}`)');
    expect(component).toContain("textDecorationLine: 'line-through'");
  });

  it('the grid shows the lineup in place of its empty state, under a search, after the TBA list and below the grid', () => {
    const grid = read('app/grid.tsx');
    expect(grid).toContain("import AnnouncedLineup from '../components/AnnouncedLineup';");
    expect(grid).toContain('const announced = useAnnouncedLineup();');
    expect(grid).toContain('if (lineupReplacesEmptyState(announced, searchQuery)) {');
    expect(grid).toContain('{searchQuery.trim() ? (');
    expect(grid).not.toContain('getCurrentDaySets().length === 0 && searchQuery.trim()');
    expect(grid).toContain('{untimedSets.length > 0 || lineupHasRows ? (');
    expect(grid).not.toContain('untimedSets.length > 0 || announced.visible');
    expect(grid.match(/<AnnouncedLineup model=\{announced\} hPad=\{t\.spacing\[4\]\} \/>/g)).toHaveLength(4);
    // The hook must run before the early returns.
    expect(grid.indexOf('useAnnouncedLineup();')).toBeLessThan(grid.indexOf('if (!currentFestival) {'));
  });

  it('the grid says set times are not out when the festival has no days', () => {
    const grid = read('app/grid.tsx');
    expect(grid).toContain('} else if (getDays().length === 0) {');
    expect(grid).toContain('title: DISCOVER_COPY.banner.title');
  });

  it('a festival with no days says set times are not out instead of "No sets for this day"', () => {
    const home = read('app/(tabs)/index.tsx');
    expect(home).toContain('title={DISCOVER_COPY.banner.title}');
    expect(home.match(/days\.length === 0 \? \(\s*noDaysState/g)).toHaveLength(2);
  });

  it('the admin editor shows the read-only line and never sends the lineup', () => {
    const edit = read('app/admin/festival-edit.tsx');
    expect(edit).toContain('announcedActsLine(full.lineup)');
    expect(edit).toContain('{announcedLine ? <Text style={styles.emptyHint}>{announcedLine}</Text> : null}');
    expect(edit).not.toMatch(/lineup:\s*form/);
  });
});
