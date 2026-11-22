import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFestivalSet } from '@festie/shared/test-fixtures/festivalSet';
import type { FestivalSet } from '@festie/shared/types';
import { act, render, screen, fireEvent, within, waitFor } from '@testing-library/react';

// Mock dependencies
const mockNavigate = vi.fn().mockResolvedValue(undefined);
let mockHash = '';
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ hash: mockHash }),
}));

vi.mock('@festie/shared/services/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: vi.fn().mockResolvedValue([]), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@festie/shared/utils', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  buildPicksIcsExport: vi.fn(() => ({ ics: 'BEGIN:VCALENDAR', timed: 1, timeTba: 0, skipped: 0 })),
  describeIcsExport: vi.fn(() => 'Added 1 set to your calendar file.'),
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

vi.mock('../components/layout/RefreshableView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="refreshable-view">{children}</div>,
}));

// OfflineReadinessCard, PickBulkActions, CrewSuggestionStrip, PicksPlanRow and
// PickConflicts have their own tests; stub them so PicksView tests stay focused
// on the plan (real stores + the real usePicksPlan drive the rows).
vi.mock('../components/features/OfflineReadinessCard', () => ({
  default: () => <div data-testid="offline-readiness-card" />,
}));
vi.mock('../components/features/ListenList', () => ({
  default: () => <div data-testid="listen-list" />,
}));
vi.mock('../components/features/CrewSuggestionStrip', () => ({ default: () => null }));
vi.mock('../components/features/RateNightBanner', () => ({ default: () => null }));
vi.mock('../components/PickBulkActions', () => ({ default: () => <div data-testid="bulk-actions" /> }));
vi.mock('../components/features/PicksPlanRow', () => ({
  default: ({ set }: { set: { artist: string } }) => <div data-testid="plan-row">{set.artist}</div>,
}));
vi.mock('../components/features/MyDayList', () => ({
  default: () => <div data-testid="my-day-list" />,
}));
vi.mock('../components/features/PlanNotesList', () => ({
  default: ({ kind, items }: { kind: string; items: unknown[] }) => (
    <div data-testid="plan-notes-list">
      {kind}:{items.length}
    </div>
  ),
}));
vi.mock('../components/features/PickConflicts', () => ({
  default: ({ groups }: { groups?: unknown[] }) => <div id="clashes" tabIndex={-1} data-testid="pick-conflicts">{groups?.length ?? 0}</div>,
}));

vi.mock('../components/features/GuestPicksBanner', () => ({
  default: () => <div data-testid="guest-picks-banner" />,
}));

// SharePicksDialog has its own test (it needs router, crew store and QR mocks).
vi.mock('../components/features/SharePicksDialog', () => ({
  default: () => <button type="button" aria-label="Share my picks">Share picks</button>,
}));

// ScheduleImageDialog has its own test (it needs the capture and export mocks).
vi.mock('../components/features/ScheduleImageDialog', () => ({
  default: () => <button type="button" aria-label="Save my picks as an image">Save image</button>,
}));

const mockToast = vi.fn();
vi.mock('../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast, toastError: vi.fn(), toastUndo: vi.fn() }),
}));

import PicksView from './picks';
import { useFestivalStore, useAuthStore, useCrewStore } from '@festie/shared/stores';
import { buildPicksIcsExport, describeIcsExport } from '@festie/shared/utils';

const DAYS = [
  { id: 'd0', festivalId: 'f1', date: '2026-06-10', label: 'Day 1', createdAt: '', updatedAt: '' },
  { id: 'd1', festivalId: 'f1', date: '2026-06-11', label: 'Day 2', createdAt: '', updatedAt: '' },
];
const STAGES = [
  { id: 'st1', name: 'Main Stage' },
  { id: 'st2', name: 'Sahara' },
];

function makeSet(id: string, artist: string, extra: Partial<FestivalSet> = {}): FestivalSet {
  return makeFestivalSet({ id, festivalId: 'f1', artist, stageId: 'st1', dayIndex: 0, createdAt: '', updatedAt: '', ...extra });
}

const picksOf = (picks: Record<string, string>) => ({ id: 'p1', userId: 'u1', picks, notes: {} });

interface StateOpts {
  user?: unknown;
  festival?: unknown;
  profile?: unknown;
  sets?: unknown[];
  selectedDay?: number;
  error?: string | null;
}

function setStoreState(opts: StateOpts = {}) {
  const has = (k: keyof StateOpts) => k in opts;
  useAuthStore.setState({
    user: (has('user') ? opts.user : { id: 'u1', username: 'testuser' }) as never,
  });
  useFestivalStore.setState({
    currentFestival: (has('festival') ? opts.festival : { id: 'f1', name: 'Bonnaroo', timeZone: 'UTC' }) as never,
    currentFestivalId: 'f1',
    currentProfile: (has('profile') ? opts.profile : picksOf({})) as never,
    sets: (opts.sets ?? []) as never,
    stages: STAGES as never,
    days: DAYS as never,
    selectedDay: opts.selectedDay ?? 0,
    festivals: [],
    isLoading: false,
    error: opts.error ?? null,
  });
}

describe('PicksView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHash = '';
    setStoreState();
  });

  it('opens the plan view, scrolls to the clash cards and clears the hash for #clashes', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mockHash = 'clashes';
    setStoreState({ sets: [makeSet('s1', 'Daft Punk')], profile: picksOf({ s1: 'must' }) });
    render(<PicksView />);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('clashes'));
    expect(document.activeElement).toBe(document.getElementById('clashes'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/picks', hash: undefined, replace: true });
  });

  it('lists a guest pick under its priority with the banner, not a teaser', () => {
    setStoreState({ user: null, profile: null, sets: [makeSet('s1', 'Daft Punk')] });
    useFestivalStore.setState({ guestPicks: { f1: { s1: 'must' } } } as never);
    render(<PicksView />);
    expect(screen.getByTestId('guest-picks-banner')).toBeInTheDocument();
    expect(screen.getByTestId('plan-row')).toHaveTextContent('Daft Punk');
  });

  it('gives a guest with picks the calendar file and the image, and a Share button that asks them to sign in', async () => {
    setStoreState({ user: null, profile: null, sets: [makeSet('s1', 'Daft Punk')] });
    useFestivalStore.setState({ guestPicks: { f1: { s1: 'must' } } } as never);
    const createObjectURL = vi.fn(() => 'blob:mock');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<PicksView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Download picks as a calendar file' }, { timeout: 5000 }));
    expect(buildPicksIcsExport).toHaveBeenCalledWith(expect.objectContaining({ picks: { s1: 'must' } }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save my picks as an image' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Share my picks' }));
    expect(mockToast).toHaveBeenCalledWith('Sign in to share your picks.', 'info');
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
    clickSpy.mockRestore();
  });

  it('shows no export buttons to a guest with no picks', () => {
    setStoreState({ user: null, profile: null, sets: [makeSet('s1', 'Daft Punk')] });
    useFestivalStore.setState({ guestPicks: {} } as never);
    render(<PicksView />);
    expect(screen.queryByLabelText('Share my picks')).toBeNull();
    expect(screen.queryByLabelText('Save my picks as an image')).toBeNull();
  });

  it('shows "No festival selected" when no festival', () => {
    setStoreState({ festival: null });
    render(<PicksView />);
    expect(screen.getByText('No festival selected')).toBeInTheDocument();
  });

  it('shows the load error and a retry when the festival list failed', () => {
    setStoreState({ festival: null, error: 'Network down' });
    render(<PicksView />);
    expect(screen.getByText("Couldn't load festivals")).toBeInTheDocument();
    expect(screen.getByText('Network down')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
    expect(screen.queryByText('No festival selected')).toBeNull();
  });

  it('shows "No picks yet" when no profile', () => {
    setStoreState({ profile: null });
    render(<PicksView />);
    expect(screen.getByText('No picks yet')).toBeInTheDocument();
  });

  it('shows "No picks yet" with no day name when the user has zero picks', () => {
    render(<PicksView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No picks yet')).toBeInTheDocument();
    expect(screen.queryByText(/Day 1/)).toBeNull();
  });

  it('"Browse the lineup" CTA in empty state navigates to the schedule', () => {
    render(<PicksView />);
    fireEvent.click(screen.getByText('Browse the lineup'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/cards' });
  });

  it('renders both day headers while the selected day is the other one', () => {
    setStoreState({
      sets: [makeSet('s1', 'Daft Punk'), makeSet('s2', 'Odesza', { dayIndex: 1 })],
      profile: picksOf({ s1: 'must', s2: 'maybe' }),
      selectedDay: 1,
    });
    render(<PicksView />);
    expect(screen.getByRole('button', { name: 'Day 1, 1 pick' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Day 2, 1 pick' })).toBeInTheDocument();
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
    expect(screen.getByText('Odesza')).toBeInTheDocument();
    expect(screen.queryByText(/No picks yet/)).toBeNull();
  });

  it('renders a pick on an unscheduled (TBA) set under Unscheduled', () => {
    setStoreState({
      sets: [
        makeSet('s1', 'Daft Punk'),
        makeSet('s2', 'Four Tet', { dayIndex: undefined, startTime: undefined, endTime: undefined }),
      ],
      profile: picksOf({ s1: 'must', s2: 'want-to-see' }),
    });
    render(<PicksView />);
    expect(screen.getByText('Four Tet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unscheduled, 1 pick' })).toBeInTheDocument();
  });

  it('the Must chip filters rows and toggles back to all', () => {
    setStoreState({
      sets: [makeSet('s1', 'Daft Punk'), makeSet('s2', 'Odesza', { startTime: '16:00', endTime: '17:00' })],
      profile: picksOf({ s1: 'must', s2: 'maybe' }),
    });
    render(<PicksView />);
    const group = screen.getByRole('group', { name: 'Filter picks' });
    fireEvent.click(within(group).getByRole('button', { name: /Must/ }));
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
    expect(screen.queryByText('Odesza')).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: /Must/ }));
    expect(screen.getByText('Odesza')).toBeInTheDocument();
  });

  it('Headliners first lists the latest set first and Openers first restores it', () => {
    localStorage.clear();
    setStoreState({
      sets: [
        makeSet('s1', 'Early', { startTime: '22:00', endTime: '23:00' }),
        makeSet('s2', 'Late', { startTime: '01:00', endTime: '02:00' }),
      ],
      profile: picksOf({ s1: 'must', s2: 'must' }),
    });
    render(<PicksView />);
    const names = () => screen.getAllByTestId('plan-row').map((r) => r.textContent);
    expect(names()).toEqual(['Early', 'Late']);
    const order = screen.getByRole('radiogroup', { name: 'Order sets' });
    fireEvent.click(within(order).getByRole('radio', { name: 'Headliners first' }));
    expect(names()).toEqual(['Late', 'Early']);
    fireEvent.click(within(order).getByRole('radio', { name: 'Openers first' }));
    expect(names()).toEqual(['Early', 'Late']);
  });

  it('shows the clash chip only when picks overlap', () => {
    setStoreState({
      sets: [makeSet('s1', 'Daft Punk'), makeSet('s2', 'Odesza', { startTime: '14:30', endTime: '15:30' })],
      profile: picksOf({ s1: 'must', s2: 'maybe' }),
    });
    const { unmount } = render(<PicksView />);
    expect(screen.getByRole('button', { name: /Clashes/ })).toBeInTheDocument();
    expect(screen.getByTestId('pick-conflicts')).toHaveTextContent('1');
    unmount();

    setStoreState({
      sets: [makeSet('s1', 'Daft Punk'), makeSet('s2', 'Odesza', { startTime: '16:00', endTime: '17:00' })],
      profile: picksOf({ s1: 'must', s2: 'maybe' }),
    });
    render(<PicksView />);
    expect(screen.queryByRole('button', { name: /Clashes/ })).toBeNull();
  });

  it('hides the clash card when a search matches no pick', () => {
    setStoreState({
      sets: [makeSet('s1', 'Daft Punk'), makeSet('s2', 'Odesza', { startTime: '14:30', endTime: '15:30' })],
      profile: picksOf({ s1: 'must', s2: 'maybe' }),
    });
    render(<PicksView />);
    expect(screen.getByTestId('pick-conflicts')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter my picks'), { target: { value: 'zzzqq' } });
    expect(screen.getByText('No matching picks')).toBeInTheDocument();
    expect(screen.queryByTestId('pick-conflicts')).toBeNull();
  });

  it('selects the first crew on a direct load so crew suggestions can show', () => {
    const selectCrew = vi.fn().mockResolvedValue(undefined);
    useCrewStore.setState({ activeCrew: null, crews: [{ id: 'c1' } as never], crewLoading: false, selectCrew });
    setStoreState({ sets: [makeSet('s1', 'Daft Punk')], profile: picksOf({ s1: 'must' }) });
    render(<PicksView />);
    expect(selectCrew).toHaveBeenCalledWith('c1');
    useCrewStore.setState(useCrewStore.getInitialState(), true);
  });

  it('does not retry selecting the first crew when the select fails', async () => {
    // The real store flips crewLoading around a select; a failed select must not re-trigger the effect.
    let finishSelect!: () => void;
    const selectGate = new Promise<void>((r) => (finishSelect = r));
    const selectCrew = vi.fn().mockImplementation(async () => {
      useCrewStore.setState({ crewLoading: true });
      await selectGate;
      useCrewStore.setState({ crewLoading: false });
      throw new Error('boom');
    });
    useCrewStore.setState({ activeCrew: null, crews: [{ id: 'c1' } as never], crewLoading: false, selectCrew });
    setStoreState({ sets: [makeSet('s1', 'Daft Punk')], profile: picksOf({ s1: 'must' }) });
    render(<PicksView />);
    expect(selectCrew).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishSelect();
      await selectGate;
    });
    expect(useCrewStore.getState().crewLoading).toBe(false);
    expect(selectCrew).toHaveBeenCalledTimes(1);
    useCrewStore.setState(useCrewStore.getInitialState(), true);
  });

  it('the search input filters by stage name', () => {
    setStoreState({
      sets: [
        makeSet('s1', 'Daft Punk'),
        makeSet('s2', 'Odesza', { stageId: 'st2', startTime: '16:00', endTime: '17:00' }),
      ],
      profile: picksOf({ s1: 'must', s2: 'must' }),
    });
    render(<PicksView />);
    fireEvent.change(screen.getByLabelText('Filter my picks'), { target: { value: 'sahara' } });
    expect(screen.getByText('Odesza')).toBeInTheDocument();
    expect(screen.queryByText('Daft Punk')).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter my picks'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matching picks')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Clear filters'));
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
  });

  it('folding a day group hides its rows', () => {
    setStoreState({ sets: [makeSet('s1', 'Daft Punk')], profile: picksOf({ s1: 'must' }) });
    render(<PicksView />);
    fireEvent.click(screen.getByRole('button', { name: 'Day 1, 1 pick' }));
    expect(screen.queryByText('Daft Punk')).toBeNull();
  });

  it('switches to My day and renders MyDayList', () => {
    setStoreState({ sets: [makeSet('s1', 'Daft Punk')], profile: picksOf({ s1: 'must' }) });
    render(<PicksView />);
    expect(screen.queryByTestId('my-day-list')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'My day' }));
    expect(screen.getByTestId('my-day-list')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'My day' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves between the view tabs and the group radios with the arrow keys, one tab stop each', () => {
    setStoreState({ sets: [makeSet('s1', 'Daft Punk')], profile: picksOf({ s1: 'must' }) });
    render(<PicksView />);
    const allPicks = screen.getByRole('tab', { name: 'All picks' });
    expect(allPicks).toHaveAttribute('aria-controls', 'picks-view-panel');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'picks-view-panel');
    allPicks.focus();
    fireEvent.keyDown(allPicks, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'My day' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'picks-tab-myday');
    fireEvent.click(screen.getByRole('tab', { name: 'All picks' }));

    const group = screen.getByRole('radiogroup', { name: 'Group picks by' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex)).toEqual([0, ...radios.slice(1).map(() => -1)]);
    radios[0]!.focus();
    fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' });
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps keyboard focus on the tab when arrowing from the plan views into Reminders and back', () => {
    setStoreState({
      sets: [makeSet('s1', 'Daft Punk')],
      profile: { id: 'p1', userId: 'u1', picks: { s1: 'must' }, notes: { s1: 'Bring water' } },
    });
    render(<PicksView />);
    const myDay = screen.getByRole('tab', { name: 'My day' });
    myDay.focus();
    fireEvent.keyDown(myDay, { key: 'ArrowRight' });
    const reminders = screen.getByRole('tab', { name: /^Reminders/ });
    expect(reminders).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(reminders);
    fireEvent.keyDown(reminders, { key: 'ArrowRight' });
    const notes = screen.getByRole('tab', { name: /^Notes/ });
    fireEvent.keyDown(notes, { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('tab', { name: /^Reminders/ }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'My day' })).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'My day' }));
  });

  it('uses a plain text field, not a search field, so the browser adds no second clear button', () => {
    setStoreState({ sets: [makeSet('s1', 'Daft Punk')], profile: picksOf({ s1: 'must' }) });
    render(<PicksView />);
    const field = screen.getByLabelText('Filter my picks');
    expect(field).toHaveAttribute('type', 'text');
    expect(field).toHaveAttribute('inputmode', 'search');
  });

  it('My day lists each day with picks once and dayless picks in one group', () => {
    setStoreState({
      sets: [
        makeSet('s1', 'Daft Punk'),
        makeSet('s2', 'Justice', { dayIndex: 1 }),
        makeSet('s3', 'Mystery', { dayIndex: undefined, startTime: '' }),
      ],
      profile: picksOf({ s1: 'must', s2: 'want-to-see', s3: 'maybe' }),
    });
    render(<PicksView />);
    fireEvent.click(screen.getByRole('tab', { name: 'My day' }));
    expect(screen.getAllByTestId('my-day-list')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Day 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Day 2' })).toBeInTheDocument();
  });

  describe('My day filters and search', () => {
    const mixed = () =>
      setStoreState({
        sets: [
          makeSet('s1', 'Daft Punk'),
          makeSet('s2', 'Justice', { dayIndex: 1 }),
          makeSet('s3', 'Odesza', { dayIndex: 1, stageId: 'st2' }),
        ],
        profile: picksOf({ s1: 'must', s2: 'want-to-see', s3: 'maybe' }),
      });
    const openMyDay = () => {
      mixed();
      render(<PicksView />);
      fireEvent.click(screen.getByRole('tab', { name: 'My day' }));
    };

    it('shows the priority chips and the search box on My day', () => {
      openMyDay();
      expect(screen.getByRole('group', { name: 'Filter picks' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Filter my picks' })).toBeInTheDocument();
      expect(screen.getAllByTestId('my-day-list')).toHaveLength(2);
    });

    it('keeps only the days that hold the chosen priority', () => {
      openMyDay();
      fireEvent.click(screen.getByRole('button', { name: /^Must/ }));
      expect(screen.getAllByTestId('my-day-list')).toHaveLength(1);
      expect(screen.getByRole('heading', { name: 'Day 1' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Day 2' })).toBeNull();
    });

    it('filters by artist or stage name and explains an empty result', () => {
      openMyDay();
      const box = screen.getByRole('textbox', { name: 'Filter my picks' });
      fireEvent.change(box, { target: { value: 'sahara' } });
      expect(screen.getAllByTestId('my-day-list')).toHaveLength(1);
      fireEvent.change(box, { target: { value: 'zzz' } });
      expect(screen.queryByTestId('my-day-list')).toBeNull();
      expect(screen.getByText('Nothing matches “zzz”.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(screen.getAllByTestId('my-day-list')).toHaveLength(2);
    });

    it('keeps the filters when the person switches to All picks and back', () => {
      openMyDay();
      fireEvent.click(screen.getByRole('button', { name: /^Must/ }));
      fireEvent.click(screen.getByRole('tab', { name: 'All picks' }));
      expect(screen.getByRole('button', { name: /^Must/ })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('Notes and Reminders search', () => {
    const withNotes = () => {
      setStoreState({
        sets: [makeSet('s1', 'Daft Punk'), makeSet('s2', 'Justice', { dayIndex: 1 })],
        profile: { id: 'p1', userId: 'u1', picks: { s1: 'must' }, notes: { s1: 'Bring water', s2: 'Meet Sam' } },
      });
      render(<PicksView />);
      fireEvent.click(screen.getByRole('tab', { name: /^Notes/ }));
    };

    it('searches the notes list by artist', () => {
      withNotes();
      expect(screen.getByTestId('plan-notes-list')).toHaveTextContent('notes:2');
      fireEvent.change(screen.getByRole('textbox', { name: 'Filter my picks' }), { target: { value: 'justice' } });
      expect(screen.getByTestId('plan-notes-list')).toHaveTextContent('notes:1');
    });

    it('explains a search that matches no note', () => {
      withNotes();
      fireEvent.change(screen.getByRole('textbox', { name: 'Filter my picks' }), { target: { value: 'zzz' } });
      expect(screen.queryByTestId('plan-notes-list')).toBeNull();
      expect(screen.getByText('Nothing matches “zzz”.')).toBeInTheDocument();
    });

    it('shows no search box when the list is empty', () => {
      setStoreState({
        sets: [makeSet('s1', 'Daft Punk')],
        profile: { id: 'p1', userId: 'u1', picks: { s1: 'must' }, notes: {} },
      });
      render(<PicksView />);
      fireEvent.click(screen.getByRole('tab', { name: /^Notes/ }));
      expect(screen.queryByRole('textbox', { name: 'Filter my picks' })).toBeNull();
    });
  });

  it('gives a guest with picks the My day tab', () => {
    setStoreState({ user: null, profile: null, sets: [makeSet('s1', 'Daft Punk')] });
    useFestivalStore.setState({ guestPicks: { f1: { s1: 'must' } } } as never);
    render(<PicksView />);
    fireEvent.click(screen.getByRole('tab', { name: 'My day' }));
    expect(screen.getByTestId('my-day-list')).toBeInTheDocument();
  });

  it('shows the tab row and the Notes list for a user with only a note', () => {
    setStoreState({
      sets: [makeSet('s1', 'Daft Punk')],
      profile: { id: 'p1', userId: 'u1', picks: {}, notes: { s1: 'Bring water' } },
    });
    render(<PicksView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Notes · 1' }));
    expect(screen.getByTestId('plan-notes-list')).toHaveTextContent('notes:1');
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });

  it('hides the tab row when there are no picks, notes or reminders', () => {
    render(<PicksView />);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('renders the region with aria-label "My picks"', () => {
    render(<PicksView />);
    expect(screen.getByRole('region', { name: 'My picks' })).toBeInTheDocument();
  });

  it('hides the calendar export button when the profile has no picks', () => {
    render(<PicksView />);
    expect(screen.queryByRole('button', { name: 'Add picks to calendar' })).toBeNull();
  });

  it('shows the calendar button and downloads an .ics via Download once', async () => {
    setStoreState({ sets: [makeSet('s1', 'Daft Punk')], profile: picksOf({ s1: 'must' }) });

    // jsdom lacks URL.createObjectURL/revokeObjectURL; stub them and the anchor
    // click so the download path runs without a real navigation.
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<PicksView />);
    // CalendarDialog is lazy and unmocked; its cold import can pass findByRole's 1s default.
    fireEvent.click(await screen.findByRole('button', { name: 'Add picks to calendar' }, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download once' }));

    expect(buildPicksIcsExport).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(describeIcsExport).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith('Added 1 set to your calendar file.', 'success');

    clickSpy.mockRestore();
  });

  it('renders the Share picks button when the profile has picks', async () => {
    setStoreState({ sets: [makeSet('s1', 'Daft Punk')], profile: picksOf({ s1: 'must' }) });
    render(<PicksView />);
    expect(await screen.findByRole('button', { name: 'Share my picks' })).toBeInTheDocument();
  });

  it('renders the Save image button when the profile has picks', async () => {
    setStoreState({ sets: [makeSet('s1', 'Daft Punk')], profile: picksOf({ s1: 'must' }) });
    render(<PicksView />);
    expect(await screen.findByRole('button', { name: 'Save my picks as an image' })).toBeInTheDocument();
  });
});
