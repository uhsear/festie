import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Festival, FestivalDay, FestivalSet, LineupEntry } from '@festie/shared/types';
import { announcedLineupModel, lineupReplacesEmptyState } from '@festie/shared/utils';
import { announcedActsLine, parseLineupView } from '../lib/lineupView';

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

const DAYS = [
  { id: 'd1', label: 'Fri', date: '2099-04-24' },
  { id: 'd2', label: 'Sat', date: '2099-04-25' },
] as unknown as FestivalDay[];

describe('announced lineup on mobile: the shared rules the home screen renders', () => {
  it('a names-only festival shows the lineup in place of "No sets for this day"', () => {
    const model = announcedLineupModel(festival([entry('a', 'Alpha'), entry('b', 'Beta')]), DAYS, [], 0, Date.now());
    expect(model.visible).toBe(true);
    expect(model.noSets).toBe(true);
    expect(model.summary.header).toBe('2 acts announced · Set times TBA');
    expect(model.selection.active.map((e) => e.id)).toEqual(['a', 'b']);
    expect(lineupReplacesEmptyState(model, '')).toBe(true);
  });

  it('a search keeps the empty state and lists the matches instead', () => {
    const model = announcedLineupModel(festival([entry('a', 'Alpha')]), DAYS, [], 0, Date.now());
    expect(lineupReplacesEmptyState(model, 'alp')).toBe(false);
  });

  it('a festival without a lineup keeps the empty state', () => {
    const model = announcedLineupModel(festival([]), DAYS, [], 0, Date.now());
    expect(model.visible).toBe(false);
    expect(lineupReplacesEmptyState(model, '')).toBe(false);
  });

  it('a day with sets keeps its sets and the lineup follows them', () => {
    const sets = [{ id: 's1', dayIndex: 0, artist: 'Gamma', artists: [{ name: 'Gamma' }] }] as unknown as FestivalSet[];
    const model = announcedLineupModel(festival([entry('a', 'Alpha')]), DAYS, sets, 0, Date.now());
    expect(model.visible).toBe(true);
    expect(lineupReplacesEmptyState(model, '')).toBe(false);
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

  it('announcedActsLine counts announced acts and skips cancelled ones', () => {
    expect(announcedActsLine([{ status: 'announced' }, { status: 'announced' }, { status: 'cancelled' }])).toBe(
      '2 announced acts. Edit them on the web.',
    );
    expect(announcedActsLine([{ status: 'announced' }])).toBe('1 announced act. Edit them on the web.');
    expect(announcedActsLine([{ status: 'cancelled' }])).toBeNull();
    expect(announcedActsLine([])).toBeNull();
    expect(announcedActsLine(undefined)).toBeNull();
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

  it('a scheduled row opens its set and a cancelled one is struck through', () => {
    expect(component).toContain('router.push(`/set/${first.id}`)');
    expect(component).toContain("textDecorationLine: 'line-through'");
  });

  it('the admin editor shows the read-only line and never sends the lineup', () => {
    const edit = read('app/admin/festival-edit.tsx');
    expect(edit).toContain('announcedActsLine(full.lineup)');
    expect(edit).toContain('{announcedLine ? <Text style={styles.emptyHint}>{announcedLine}</Text> : null}');
    expect(edit).not.toMatch(/lineup:\s*form/);
  });
});
