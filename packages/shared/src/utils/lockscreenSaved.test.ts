import { describe, it, expect } from 'vitest';
import type { FestivalDay, FestivalSet, Stage } from '../types/domain';
import {
  lockscreenChangeText,
  lockscreenChanges,
  lockscreenSavedKey,
  lockscreenSnapshot,
  parseSavedImageRecord,
  savedImageExpired,
} from './lockscreenSaved';

const set = (id: string, artist: string, startTime: string, endTime: string, stageId = 'k'): FestivalSet => ({
  id, festivalId: 'f', stageId, startTime, endTime, artist, dayIndex: 0, createdAt: '', updatedAt: '',
});
const stages: Stage[] = [
  { id: 'k', name: 'kineticFIELD', festivalId: 'f', createdAt: '', updatedAt: '' },
  { id: 'n', name: 'neonGARDEN', festivalId: 'f', createdAt: '', updatedAt: '' },
];
const days: FestivalDay[] = [{ id: 'd0', festivalId: 'f', date: '2026-11-06', label: 'Friday', createdAt: '', updatedAt: '' }];
const base = [set('a', 'Tycho', '23:00', '00:30'), set('b', 'Kaskade', '21:00', '22:30'), set('c', 'Sippy', '19:00', '20:00')];
const record = lockscreenSnapshot({ festivalId: 'f', dayIndex: 0, setIds: ['a', 'b', 'c', 'gone'], sets: base, savedAt: 1 });

describe('lockscreenSaved', () => {
  it('keys records per festival day and round-trips them', () => {
    expect(lockscreenSavedKey('f', 2)).toBe('festie.lockscreen.saved.f.2');
    expect(record.sets.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(parseSavedImageRecord(JSON.stringify(record))).toEqual(record);
    expect(parseSavedImageRecord('{bad')).toBeNull();
    expect(parseSavedImageRecord(JSON.stringify({ ...record, v: 2 }))).toBeNull();
  });

  it('reports nothing when the lineup is unchanged', () => {
    expect(lockscreenChanges(record, base, stages)).toEqual([]);
    expect(lockscreenChangeText([])).toBe('');
  });

  it('names moved times, stage moves, renames and removed sets', () => {
    const now = [
      set('a', 'Tycho', '23:30', '01:00'),
      set('b', 'Kaskade', '21:00', '22:30', 'n'),
      set('c', 'Sippy B2B Friend', '19:00', '20:00'),
    ];
    const changes = lockscreenChanges(lockscreenSnapshot({ ...record, setIds: ['a', 'b', 'c'], sets: base, festivalId: 'f' }), now, stages);
    expect(changes.map((c) => c.text)).toEqual([
      'Tycho moved 11:00 PM → 11:30 PM',
      'Kaskade moved to neonGARDEN',
      'Sippy is now Sippy B2B Friend',
    ]);
    expect(lockscreenChangeText(changes)).toBe(
      'Tycho moved 11:00 PM → 11:30 PM. Kaskade moved to neonGARDEN +1 more. Your lock-screen image is out of date.',
    );
    expect(lockscreenChanges(record, base.slice(1), stages)[0]!.text).toBe('Tycho is no longer in the lineup');
  });

  it('names an end-time change', () => {
    const now = [set('a', 'Tycho', '23:00', '01:00'), ...base.slice(1)];
    expect(lockscreenChanges(record, now, stages)[0]!.text).toBe('Tycho now ends 1:00 AM');
  });

  it('expires once every saved set has ended', () => {
    const tz = 'America/New_York';
    // Tycho ends 00:30 on Nov 7 local = 05:30Z.
    expect(savedImageExpired(record, base, days, Date.parse('2026-11-07T05:00:00Z'), tz)).toBe(false);
    expect(savedImageExpired(record, base, days, Date.parse('2026-11-07T06:00:00Z'), tz)).toBe(true);
  });
});
