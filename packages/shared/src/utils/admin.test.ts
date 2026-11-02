import { describe, it, expect } from 'vitest';
import {
  maskEmail,
  summarizeBulkResults,
  toggleSelection,
  filterAdminCrews,
  buildFestivalPreview,
  roleChangeCopy,
  BULK_LIMIT,
  type FestivalPreviewInput,
} from './admin';

describe('maskEmail', () => {
  it('keeps the first letter and the domain tail', () => {
    expect(maskEmail('asir@example.com')).toBe('a@…e.com');
  });
  it('never returns the full address for short domains', () => {
    expect(maskEmail('bo@x.io')).toBe('b@…x.io');
  });
  it('hides malformed values completely', () => {
    expect(maskEmail('not-an-email')).toBe('…');
    expect(maskEmail('@x.com')).toBe('…');
  });
  it('says No email for null and empty', () => {
    expect(maskEmail(null)).toBe('No email');
    expect(maskEmail('')).toBe('No email');
  });
});

describe('summarizeBulkResults', () => {
  it('reports all ok', () => {
    expect(summarizeBulkResults('force-logout', [{ status: 'logged_out' }, { status: 'logged_out' }])).toBe(
      'Logged out 2 of 2 users.',
    );
  });
  it('adds the failed count', () => {
    expect(summarizeBulkResults('archive', [{ status: 'archived' }, { status: 'error' }])).toBe(
      'Archived 1 of 2 festivals. 1 failed.',
    );
  });
  it('uses singular for one', () => {
    expect(summarizeBulkResults('force-logout', [{ status: 'logged_out' }])).toBe('Logged out 1 of 1 user.');
  });
});

describe('toggleSelection', () => {
  const full = new Set(Array.from({ length: BULK_LIMIT }, (_, i) => `u${i}`));
  it('refuses the 51st add', () => {
    const { next, limited } = toggleSelection(full, 'extra');
    expect(limited).toBe(true);
    expect(next.size).toBe(BULK_LIMIT);
    expect(next.has('extra')).toBe(false);
  });
  it('removes at the limit', () => {
    const { next, limited } = toggleSelection(full, 'u0');
    expect(limited).toBe(false);
    expect(next.size).toBe(BULK_LIMIT - 1);
  });
});

describe('filterAdminCrews', () => {
  const crews = [
    { name: 'Alpha', creatorUsername: 'alice', festivalName: 'EDC', inviteCode: 'ABC123' },
    { name: 'Beta', creatorUsername: null, festivalName: null, inviteCode: 'ZZZ999' },
  ];
  it('matches an invite code in lower case', () => {
    expect(filterAdminCrews(crews, 'abc1')).toEqual([crews[0]]);
  });
  it('matches a creator username', () => {
    expect(filterAdminCrews(crews, 'ALIC')).toEqual([crews[0]]);
  });
  it('returns the input for an empty query', () => {
    expect(filterAdminCrews(crews, '')).toBe(crews);
  });
});

describe('roleChangeCopy', () => {
  it('names the user in grant and revoke titles', () => {
    expect(roleChangeCopy('bob', true).title).toBe('Grant admin to @bob?');
    expect(roleChangeCopy('bob', false).title).toBe('Revoke admin from @bob?');
  });
});

describe('buildFestivalPreview', () => {
  const ts = '2026-01-01T00:00:00Z';
  const set = (id: string, stageId: string, startTime: string, endTime: string, artist: string) => ({
    id,
    festivalId: 'f',
    stageId,
    startTime,
    endTime,
    artist,
    createdAt: ts,
    updatedAt: ts,
  });
  const detail = {
    id: 'f',
    name: 'Fest',
    startDate: '2026-05-01',
    endDate: '2026-05-02',
    stages: [
      { id: 's1', name: 'Main', color: '#f00', festivalId: 'f', latitude: 1, longitude: 2, createdAt: ts, updatedAt: ts },
      { id: 's2', name: 'Tent', festivalId: 'f', createdAt: ts, updatedAt: ts },
    ],
    days: [
      {
        dayIndex: 0,
        date: '2026-05-01',
        label: 'Fri',
        sets: [
          set('b', 's2', '20:00', '21:00', 'Later'),
          set('a', 's1', '18:00', '', 'Early'),
          set('c', 's1', '', '', 'Nope'),
        ],
      },
      { dayIndex: 1, date: '2026-05-02', label: 'Sat', sets: [] },
    ],
  } as unknown as FestivalPreviewInput;

  it('sorts sets, looks up stage names and formats times', () => {
    const p = buildFestivalPreview(detail);
    expect(p.days[0].sets.map((s) => s.artist)).toEqual(['Early', 'Later', 'Nope']);
    expect(p.days[0].sets[0]).toMatchObject({ time: '6:00 PM', stageName: 'Main', stageColor: '#f00' });
    expect(p.days[0].sets[1].time).toBe('8:00 PM – 9:00 PM');
    expect(p.days[0].sets[2].time).toBe('Time TBA');
  });
  it('keys days by dayIndex because the server sends no day id', () => {
    const keys = buildFestivalPreview(detail).days.map((d) => d.key);
    expect(keys).toEqual(['0', '1']);
  });
  it('warns about unpinned stages, untimed sets and empty days', () => {
    const p = buildFestivalPreview(detail);
    expect(p.stages.map((s) => s.pinned)).toEqual([true, false]);
    expect(p.warnings).toEqual(['1 stage has no map pin: Tent.', '1 set has no start time.', 'Sat has no sets.']);
  });
});
