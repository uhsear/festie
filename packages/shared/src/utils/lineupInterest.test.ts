import { describe, it, expect } from 'vitest';
import type { FestivalDay, FestivalSet, LineupEntry, Stage } from '../types/domain';
import type { LineupCover } from './lineupCover';
import { interestedRows, markedWithoutSet } from './lineupInterest';

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
const lineup = [entry('lu-a', 'Alpha'), entry('lu-b', 'Beta'), entry('lu-c', 'Gamma'), entry('lu-d', 'Delta')];
const days = [{ date: '2099-02-06', label: 'Fri' }] as FestivalDay[];
const stages = [{ id: 'main', name: 'Main Stage' }] as Stage[];
const sets = [
  { id: 's1', stageId: 'main', artist: 'Beta', dayIndex: 0, startTime: '22:00' },
  { id: 's2', stageId: 'main', artist: 'Gamma', dayIndex: 0, startTime: '' },
] as FestivalSet[];
const cover: Record<string, LineupCover> = {
  'lu-a': { setIds: [], state: 'announced', dayIndex: -1 },
  'lu-b': { setIds: ['s1'], state: 'scheduled', dayIndex: 0 },
  'lu-c': { setIds: ['s2'], state: 'scheduled', dayIndex: 0 },
  'lu-d': { setIds: [], state: 'cancelled', dayIndex: -1 },
};

const rows = (marks: Parameters<typeof interestedRows>[0]['marks'], picks = {}) =>
  interestedRows({ lineup, marks, cover, picks, sets, days, stages });

describe('interestedRows', () => {
  it('lists open marks first, then converted ones, and skips acts that left the lineup', () => {
    const result = rows({
      'lu-b': { state: 'converted', sets: ['s1'] },
      'lu-a': { state: 'open' },
      'lu-gone': { state: 'open' },
    });
    expect(result.map((r) => r.entry.id)).toEqual(['lu-a', 'lu-b']);
  });

  it('reads the real picks for a converted mark: in your picks, or not in your picks with Add to picks', () => {
    const inPicks = rows({ 'lu-b': { state: 'converted', sets: ['s1'] } }, { s1: 'want-to-see' })[0]!;
    expect(inPicks.status).toBe('in-picks');
    expect(inPicks.pickedWhen).toContain('Fri');
    expect(inPicks.pickedWhen).toContain('10:00 PM');
    expect(inPicks.addSetIds).toEqual([]);

    const removed = rows({ 'lu-b': { state: 'converted', sets: ['s1'] } }, {})[0]!;
    expect(removed.status).toBe('not-in-picks');
    expect(removed.addSetIds).toEqual(['s1']);
  });

  it('an untimed pick reads Time TBA', () => {
    const row = rows({ 'lu-c': { state: 'converted', sets: ['s2'] } }, { s2: 'want-to-see' })[0]!;
    expect(row.pickedWhen).toContain('Time TBA');
  });

  it('an open mark that sets already cover offers Add to picks, one nothing covers waits', () => {
    const covered = rows({ 'lu-b': { state: 'open' } })[0]!;
    expect(covered.status).toBe('has-set');
    expect(covered.addSetIds).toEqual(['s1']);
    const waiting = rows({ 'lu-a': { state: 'open' } })[0]!;
    expect(waiting.status).toBe('waiting');
    expect(waiting.addSetIds).toEqual([]);
  });

  it('a cancelled act keeps its row with a cancelled status', () => {
    expect(rows({ 'lu-d': { state: 'open' } })[0]?.status).toBe('cancelled');
  });

  it('returns nothing without marks', () => {
    expect(rows(null)).toEqual([]);
    expect(rows(undefined)).toEqual([]);
  });
});

describe('markedWithoutSet', () => {
  it('keeps only the open marks no set covers', () => {
    const all = rows({ 'lu-a': { state: 'open' }, 'lu-b': { state: 'open' }, 'lu-d': { state: 'open' } });
    expect(markedWithoutSet(all).map((r) => r.entry.id)).toEqual(['lu-a']);
  });
});
