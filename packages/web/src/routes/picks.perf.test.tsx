import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Profiler } from 'react';
import { render, act } from '@testing-library/react';
import type { FestivalSet, Profile } from '@festie/shared/types';
import { useFestivalStore } from '@festie/shared/stores';

// Render-count guard for the Picks list: a note write on one row commits only
// that row. Real stores and the real PicksPlanRow run.

vi.mock('@festie/shared/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(() => new Promise(() => {})), delete: vi.fn() },
  mapErrorToUserMessage: (_e: unknown, fallback: string) => fallback,
}));
vi.mock('../lib/useUndoNotifier', () => ({ useUndoNotifier: () => ({ info: vi.fn(), error: vi.fn(), undo: vi.fn() }) }));
vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import PicksPlanRow from '../components/features/PicksPlanRow';

const SETS: FestivalSet[] = Array.from(
  { length: 40 },
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

let commits: Record<string, number>;

describe('Picks perf: render counts', () => {
  beforeEach(() => {
    useFestivalStore.setState({
      currentFestivalId: 'f1',
      currentFestival: { id: 'f1', name: 'Fest' } as never,
      currentProfile: {
        id: 'me',
        userId: 'u-me',
        festivalId: 'f1',
        picks: Object.fromEntries(SETS.map((s) => [s.id, 'must'])),
        notes: {},
        updatedAt: '2030-01-01T00:00:00Z',
      } as unknown as Profile,
      stages: [{ id: 'st1', name: 'Main', color: '#00e8d0' }] as never,
      days: [],
      pickSync: {},
    } as never);
    commits = {};
  });

  it('a note write on one row commits only that row', () => {
    render(
      <>
        {SETS.map((set) => (
          <Profiler key={set.id} id={set.id} onRender={(id) => (commits[id] = (commits[id] ?? 0) + 1)}>
            <PicksPlanRow set={set} hasClash={false} />
          </Profiler>
        ))}
      </>,
    );
    commits = {};
    act(() => {
      void useFestivalStore.getState().saveNote({ festivalId: 'f1', setId: 's7', note: 'front row' });
    });
    expect(commits['s7']).toBeGreaterThanOrEqual(1);
    const others = SETS.filter((s) => s.id !== 's7').reduce((n, s) => n + (commits[s.id] ?? 0), 0);
    expect(others).toBe(0);
  });
});
