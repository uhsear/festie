import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── State the mocks read from (mutated per test) ───────────────────────────
const authState: Record<string, unknown> = { user: { id: 'u-me' } };
const crewState: Record<string, unknown> = {};
const festivalState: Record<string, unknown> = {};
const uiState: Record<string, unknown> = { offlineMode: false, pendingSync: 0 };

const activeCrew = { status: 'ready', crew: null as unknown, crews: [] as unknown[], retry: vi.fn() };
const crewFestival = { state: 'match', festivalName: 'Forbidden Kingdom', retry: vi.fn() };
const hubState: Record<string, unknown> = {};
const savePick = vi.fn(() => Promise.resolve());
const navigate = vi.fn(() => Promise.resolve());

vi.mock('@festie/shared/stores', () => ({
  useAuthStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(authState)),
  useCrewStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(crewState)),
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(festivalState)),
}));

vi.mock('@festie/shared/hooks', () => ({
  useActiveCrew: () => activeCrew,
  useCrewFestival: () => crewFestival,
  useCrewHub: () => hubState,
  usePicks: () => ({ savePick }),
}));

// FreshnessChip reaches into these split-store entry points directly.
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(uiState)),
}));
vi.mock('@festie/shared/stores/crewStore', () => ({
  useCrewStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(crewState)),
}));
vi.mock('@festie/shared/stores/festivalDataStore', () => ({
  useFestivalDataStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(crewState)),
}));

// Real router would need a RouterProvider context; stub the two primitives.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params: _params,
    search: _search,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: unknown;
    search?: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}));

vi.mock('../components/ui/EmptyState', () => ({
  default: ({
    title,
    description,
    cta,
  }: {
    title: string;
    description?: string;
    cta?: { label: string; onClick: () => void };
  }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {cta && <button onClick={cta.onClick}>{cta.label}</button>}
    </div>
  ),
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CrewPlanView from './crew-plan';

const FIXED_NOW = new Date('2026-06-15T14:00:00');

const setS1 = {
  id: 's1',
  festivalId: 'f1',
  stageId: 'st1',
  artist: 'Disclosure',
  startTime: '15:00',
  endTime: '16:00',
};

function baseCrew(owner = 'u-me') {
  return {
    id: 'c1',
    name: 'Sunset Squad',
    owner,
    members: [],
    homeBaseLocation: 'Lot C, blue flag',
    homeBaseTime: 'Back by 2am',
  };
}

function baseHub(over: Record<string, unknown> = {}) {
  return {
    crew: baseCrew(),
    festivalName: 'Forbidden Kingdom',
    memberCount: 2,
    isOwner: true,
    ownerName: 'Sam',
    meetingPoint: {
      id: 'mp1',
      label: 'The big tree',
      location: 'Near main gate',
      meet_at: null,
    },
    isPast: false,
    upNext: [
      {
        startMs: 1,
        startTime: '15:00',
        groups: [{ set: setS1, priority: 'must', names: ['Me', 'Ari'], memberIds: ['u-me', 'u-friend'] }],
      },
    ],
    howWeDid: [],
    mix: [],
    whereabouts: [],
    openPolls: [],
    myPicks: {},
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  savePick.mockClear();
  navigate.mockClear();
  activeCrew.status = 'ready';
  activeCrew.retry = vi.fn();
  crewFestival.state = 'match';
  crewFestival.retry = vi.fn();
  authState.user = { id: 'u-me' };
  uiState.offlineMode = false;
  uiState.pendingSync = 0;
  crewState._cachedAt = Date.now() - 5 * 60_000;
  crewState._festivalCachedAt = Date.now() - 5 * 60_000;
  festivalState.currentFestival = { id: 'f1', name: 'Forbidden Kingdom' };
  festivalState.stages = [{ id: 'st1', name: 'Main Stage' }];
  for (const k of Object.keys(hubState)) delete hubState[k];
  Object.assign(hubState, baseHub());
  activeCrew.crew = hubState.crew;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CrewPlanView', () => {
  it('renders the cached hub before any request resolves', () => {
    render(<CrewPlanView />);
    expect(screen.getByText('The big tree')).toBeInTheDocument();
    expect(screen.getByText('Lot C, blue flag')).toBeInTheDocument();
    expect(screen.getByText('Back by 2am')).toBeInTheDocument();
    expect(screen.getByText('Disclosure')).toBeInTheDocument();
    expect(screen.getByText(/Main Stage/)).toBeInTheDocument();
    expect(screen.getByText(/Me, Ari/)).toBeInTheDocument();
    expect(screen.getByText('Must')).toBeInTheDocument();
    expect(screen.getByText('Forbidden Kingdom · 2 members')).toBeInTheDocument();
  });

  it('shows an empty state with a way forward when nothing is coming up', () => {
    hubState.upNext = [];
    render(<CrewPlanView />);
    expect(screen.getByText('No crew picks coming up.')).toBeInTheDocument();
    expect(screen.getByText('Browse the lineup')).toBeInTheDocument();
    expect(screen.getByText('Invite your crew')).toBeInTheDocument();
  });

  it('renders "No crew yet" with a create-or-join button', () => {
    activeCrew.status = 'none';
    activeCrew.crew = null;
    render(<CrewPlanView />);
    expect(screen.getByText('No crew yet')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Create or join a crew'));
    expect(navigate).toHaveBeenCalledWith({ to: '/crew' });
  });

  it('renders the crew error with a retry', () => {
    activeCrew.status = 'error';
    render(<CrewPlanView />);
    expect(screen.getByText("Couldn't load your crew")).toBeInTheDocument();
    fireEvent.click(screen.getByText('Try again'));
    expect(activeCrew.retry).toHaveBeenCalled();
  });

  it('shows the opening line while the festival switches', () => {
    crewFestival.state = 'switching';
    render(<CrewPlanView />);
    expect(screen.getByText('Opening Forbidden Kingdom…')).toBeInTheDocument();
  });

  it('shows a retry when the festival switch fails', () => {
    crewFestival.state = 'failed';
    render(<CrewPlanView />);
    expect(screen.getByText("Couldn't open Forbidden Kingdom")).toBeInTheDocument();
    fireEvent.click(screen.getByText('Try again'));
    expect(crewFestival.retry).toHaveBeenCalled();
  });

  it('after the festival, shows How the crew did and the Wrap link, not the add-picks links', () => {
    Object.assign(hubState, baseHub({ isPast: true, upNext: [], howWeDid: [{ set: setS1, count: 2, total: 2 }] }));
    render(<CrewPlanView />);
    expect(screen.getByText('How the crew did')).toBeInTheDocument();
    expect(screen.getByText('See your Wrap')).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 picked it/)).toBeInTheDocument();
    expect(screen.queryByText('Browse the lineup')).not.toBeInTheDocument();
  });

  it('Add saves the pick with the group priority, and is absent for a set already picked', () => {
    const { unmount } = render(<CrewPlanView />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Disclosure to my picks' }));
    expect(savePick).toHaveBeenCalledWith('f1', 's1', 'must');
    unmount();

    hubState.myPicks = { s1: 'maybe' };
    render(<CrewPlanView />);
    expect(screen.queryByRole('button', { name: 'Add Disclosure to my picks' })).not.toBeInTheDocument();
  });

  it('a member sees who to ask and no Set home base button', () => {
    Object.assign(
      hubState,
      baseHub({ isOwner: false, crew: { ...baseCrew('u-sam'), homeBaseLocation: null, homeBaseTime: null } }),
    );
    render(<CrewPlanView />);
    expect(screen.getByText(/Ask Sam to set one\./)).toBeInTheDocument();
    expect(screen.queryByText('Set home base')).not.toBeInTheDocument();
  });

  it('the owner sees Set home base when none is set', () => {
    Object.assign(hubState, baseHub({ crew: { ...baseCrew(), homeBaseLocation: null, homeBaseTime: null } }));
    render(<CrewPlanView />);
    expect(screen.getByText('Set home base')).toBeInTheDocument();
  });

  it('renders Crew mix', () => {
    hubState.mix = [{ set: setS1, count: 3, total: 5 }];
    render(<CrewPlanView />);
    expect(screen.getByText('Crew mix')).toBeInTheDocument();
    expect(screen.getByText('3 of 5 want this')).toBeInTheDocument();
  });

  it('renders Where everyone is and Open polls', () => {
    hubState.whereabouts = [
      {
        userId: 'u2',
        name: 'Ari',
        statusLabel: 'Here · Main Stage',
        statusAt: null,
        live: null,
        liveAt: null,
        sos: false,
      },
    ];
    hubState.openPolls = [
      { id: 'p1', question: 'Dinner?' },
      { id: 'p2', question: 'Late set?' },
      { id: 'p3', question: 'Brunch?' },
    ];
    render(<CrewPlanView />);
    expect(screen.getByText('Ari · Here · Main Stage')).toBeInTheDocument();
    expect(screen.getByText('Dinner?')).toBeInTheDocument();
    expect(screen.queryByText('Brunch?')).not.toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Vote'));
    expect(navigate).toHaveBeenCalledWith({ to: '/crew', search: { tab: 'plan' } });
  });
});
