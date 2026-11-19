import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Guard for the T19 competitor-study addendum: every set row shows start - end, not the start alone.
// Each row is rendered for real; only stores, hooks and the router are stubbed.
const { select, hubState } = vi.hoisted(() => {
  const storeState: Record<string, unknown> = {
    user: { id: 'u-me' },
    currentFestival: { id: 'f1', name: 'Fest' },
    stages: [{ id: 'st1', name: 'Main Stage', color: '#ccc' }],
    allProfiles: [],
    days: [],
    crewMembers: [],
    offlineMode: false,
    pendingSync: 0,
    setDetailSet: () => undefined,
  };
  return {
    select: (sel: (s: Record<string, unknown>) => unknown) => sel(storeState),
    hubState: { value: {} as Record<string, unknown> },
  };
});
const activeCrew = { status: 'ready', crew: null as unknown, crews: [], retry: vi.fn() };

vi.mock('@festie/shared/stores', () => ({ useAuthStore: select, useCrewStore: select, useFestivalStore: select, useUIStore: select }));
vi.mock('@festie/shared/stores/uiStore', () => ({ useUIStore: select }));
vi.mock('@festie/shared/stores/crewStore', () => ({ useCrewStore: select }));
vi.mock('@festie/shared/stores/festivalDataStore', () => ({ useFestivalDataStore: select }));
vi.mock('@festie/shared/services/api', () => ({ api: { get: vi.fn() } }));
vi.mock('@festie/shared/hooks', () => ({
  useActiveCrew: () => activeCrew,
  useCrewFestival: () => ({ state: 'match', festivalName: 'Fest', retry: vi.fn() }),
  useCrewHub: () => hubState.value,
  usePicks: () => ({ getMyPick: () => null, savePick: vi.fn(), getMyNote: () => '' }),
  usePickSync: () => ({ sync: undefined, retry: vi.fn() }),
  usePickClear: () => vi.fn(),
  useSetMove: () => null,
  useMyPick: () => null,
  useMyNote: () => '',
  useMyReminder: () => undefined,
  usePickActions: () => ({ savePick: vi.fn() }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params: _p, search: _s, ...rest }: { children: React.ReactNode; to: string; params?: unknown; search?: unknown }) =>
    React.createElement('a', { href: to, ...rest }, children),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/useSetStatus', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSetStatus: () => ({ status: 'later', label: '3:00 PM', minutesUntil: 300, progress: 0 }),
}));
vi.mock('@/hooks/useHaptics', () => ({ useHaptics: () => ({ tap: vi.fn(), select: vi.fn(), warning: vi.fn() }) }));
vi.mock('@/lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/useUndoNotifier', () => ({ useUndoNotifier: () => ({ info: vi.fn(), error: vi.fn(), undo: vi.fn() }) }));

import SetCard from '../components/features/SetCard';
import PicksPlanRow from '../components/features/PicksPlanRow';
import CrewPlanView from '../routes/crew-plan';

const set = {
  id: 's1',
  festivalId: 'f1',
  stageId: 'st1',
  artist: 'Odesza',
  startTime: '14:00',
  endTime: '15:00',
  dayIndex: 0,
  createdAt: '',
  updatedAt: '',
} as never;
const RANGE = '2:00 PM - 3:00 PM';

describe('set rows show start - end', () => {
  it('SetCard', () => {
    render(React.createElement(SetCard, { set, onTap: vi.fn(), stageName: 'Main Stage', stageColor: '#ff3366' }));
    expect(screen.getByText(RANGE)).toBeInTheDocument();
  });

  it('PicksPlanRow', () => {
    render(React.createElement(PicksPlanRow, { set }));
    expect(screen.getByText(RANGE)).toBeInTheDocument();
  });

  it('crew plan up-next row', () => {
    hubState.value = {
      crew: { id: 'c1', name: 'Squad', owner: 'u-me', members: [] },
      festivalName: 'Fest',
      memberCount: 2,
      isOwner: true,
      ownerName: 'Sam',
      meetingPoint: null,
      isPast: false,
      upNext: [{ startMs: 1, startTime: '14:00', groups: [{ set, priority: 'must', names: ['Me'], memberIds: ['u-me'] }] }],
      howWeDid: [],
      mix: [],
      whereabouts: [],
      openPolls: [],
      myPicks: {},
    };
    activeCrew.crew = (hubState.value as { crew: unknown }).crew;
    render(React.createElement(CrewPlanView));
    expect(screen.getByText(new RegExp(RANGE))).toBeInTheDocument();
  });
});
