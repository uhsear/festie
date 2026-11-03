import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Profiler } from 'react';
import { render, act } from '@testing-library/react';
import type { FestivalSet, Profile } from '@festie/shared/types';
import { useFestivalStore } from '@festie/shared/stores';

// Render-count guard for the Cards list. One pick must commit one card, not the
// whole day. Real stores and the real SetCard run; only the network, the toast
// and the set-status clock are mocked.

vi.mock('@festie/shared/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(() => new Promise(() => {})), delete: vi.fn() },
  mapErrorToUserMessage: (_e: unknown, fallback: string) => fallback,
}));
vi.mock('@/hooks/useSetStatus', () => ({
  useSetStatus: () => ({ status: 'later', label: '3:00 PM', minutesUntil: 300, progress: 0 }),
}));
vi.mock('@/lib/useUndoNotifier', () => ({ useUndoNotifier: () => ({ info: vi.fn(), error: vi.fn(), undo: vi.fn() }) }));
vi.mock('@/hooks/useHaptics', () => ({ useHaptics: () => ({ tap: vi.fn(), select: vi.fn(), warning: vi.fn() }) }));

import SetCard from '../components/features/SetCard';

const SETS: FestivalSet[] = Array.from(
  { length: 60 },
  (_, i) =>
    ({
      id: `s${i}`,
      festivalId: 'f1',
      stageId: 'st1',
      dayIndex: 0,
      artist: `Artist ${i}`,
      startTime: '14:00',
      endTime: '15:00',
      createdAt: '2030-01-01T00:00:00Z',
      updatedAt: '2030-01-01T00:00:00Z',
    }) as FestivalSet,
);

const PROFILE = {
  id: 'me',
  userId: 'u-me',
  festivalId: 'f1',
  picks: {},
  notes: {},
  updatedAt: '2030-01-01T00:00:00Z',
} as unknown as Profile;

const FRIENDS = [{ profileId: 'p2', name: 'Bob', priority: 'must' as const }];
const FRIEND_SET_IDS = new Set(['s1', 's2', 's3', 's4', 's5']);

let commits: Record<string, number>;
const onRender = (id: string) => {
  commits[id] = (commits[id] ?? 0) + 1;
};

function renderCards() {
  return render(
    <>
      {SETS.map((set) => (
        <Profiler key={set.id} id={set.id} onRender={onRender}>
          <SetCard set={set} onTap={vi.fn()} friendProfiles={FRIEND_SET_IDS.has(set.id) ? FRIENDS : []} />
        </Profiler>
      ))}
    </>,
  );
}

describe('Cards perf: render counts', () => {
  beforeEach(() => {
    useFestivalStore.setState({
      currentFestivalId: 'f1',
      currentFestival: { id: 'f1', name: 'Fest' } as never,
      currentProfile: PROFILE,
      allProfiles: [PROFILE],
      days: [],
      stages: [],
      pickSync: {},
    } as never);
    commits = {};
  });

  it('a pick on one set commits only that card', () => {
    renderCards();
    commits = {};
    act(() => {
      void useFestivalStore.getState().savePick({ festivalId: 'f1', setId: 's7', priority: 'must' });
    });
    expect(commits['s7']).toBeGreaterThanOrEqual(1);
    const others = SETS.filter((s) => s.id !== 's7').reduce((n, s) => n + (commits[s.id] ?? 0), 0);
    expect(others).toBe(0);
  });

  it('a crew mate pick commits only cards that show friends', () => {
    renderCards();
    commits = {};
    act(() => {
      useFestivalStore.setState({
        allProfiles: [PROFILE, { ...PROFILE, id: 'p2', userId: 'u2', picks: { s20: 'must' } } as unknown as Profile],
      } as never);
    });
    for (const s of SETS) {
      if (FRIEND_SET_IDS.has(s.id)) expect(commits[s.id]).toBeGreaterThanOrEqual(1);
      else expect(commits[s.id] ?? 0).toBe(0);
    }
  });
});
