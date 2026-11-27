import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { makeFestivalSet } from '@festie/shared/test-fixtures/festivalSet';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FestivalSet, Priority } from '@festie/shared/types';
import type { SetStatusResult } from '@festie/shared/utils';

// Mock dependencies
const clearPickMock = vi.fn();
const moveMock = vi.hoisted(() => ({ value: null as null | { chip: string; line: string; a11y: string } }));
const pickSyncMock = { sync: undefined as { state: string; priority: string | null } | undefined, retry: vi.fn(() => Promise.resolve()) };
vi.mock('@festie/shared/hooks', () => {
  const usePicks = vi.fn(() => ({
    getMyPick: vi.fn((_id: string): Priority | null => null),
    savePick: vi.fn(),
    getMyNote: vi.fn((_id: string) => ''),
  }));
  return {
    usePickSync: () => pickSyncMock,
    usePickClear: () => clearPickMock,
    useSetMove: () => moveMock.value,
    usePicks,
    // The per-set hooks read through the usePicks mock so each test seeds one place.
    useMyPick: (id: string) => usePicks().getMyPick(id),
    useMyNote: (id: string) => usePicks().getMyNote(id),
    usePickActions: () => ({ savePick: usePicks().savePick }),
  };
});

// Mutable store snapshots so individual tests can seed allProfiles / crewMembers
// for the crew-overlap avatar join without re-mocking the module.
const festivalStoreState: Record<string, unknown> = {
  currentFestival: { id: 'fest-1' },
  allProfiles: [],
  days: [],
};
const crewStoreState: Record<string, unknown> = {
  crewMembers: [],
};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: Record<string, unknown>) => unknown) => selector(festivalStoreState),
  useCrewStore: (selector: (s: Record<string, unknown>) => unknown) => selector(crewStoreState),
}));

vi.mock('@festie/shared/services/api', () => ({
  api: { get: vi.fn() },
}));

vi.mock('@/hooks/useSetStatus', () => ({
  useSetStatus: vi.fn(() => ({ status: 'later', label: '3:00 PM', minutesUntil: 300, progress: 0 })),
}));

vi.mock('@/lib/toastContext', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('@/hooks/useUndoNotifier', () => ({
  useUndoNotifier: () => ({ info: vi.fn(), error: vi.fn(), undo: vi.fn() }),
}));

vi.mock('@/hooks/useHaptics', () => ({
  useHaptics: vi.fn(() => ({ tap: vi.fn(), select: vi.fn(), warning: vi.fn() })),
}));

vi.mock('./LiveBadge', () => ({
  default: ({ status: _status, label }: { status: string; label: string }) => (
    <div data-testid="live-badge">{label}</div>
  ),
}));

import SetCard from './SetCard';
import { useSetStatus } from '@/hooks/useSetStatus';
import { api } from '@festie/shared/services/api';
import { usePicks } from '@festie/shared/hooks';
import { useArtistSheetStore } from '@festie/shared/stores/artistSheetStore';

// useSetStatus is overloaded; pin the single-set overload so mockReturnValue takes one result.
const setStatusMock = vi.mocked(useSetStatus) as unknown as Mock<(set: FestivalSet) => SetStatusResult>;

// The component reads only these three members of usePicks.
const mockPicks = (pick: Priority | null, note = '') =>
  vi.mocked(usePicks).mockReturnValue({
    getMyPick: vi.fn(() => pick),
    savePick: vi.fn(),
    getMyNote: vi.fn(() => note),
  } as unknown as ReturnType<typeof usePicks>);

function makeSet(overrides: Partial<FestivalSet> = {}): FestivalSet {
  return makeFestivalSet({ artist: 'Daft Punk', ...overrides });
}

describe('SetCard', () => {
  const defaultProps = {
    set: makeSet(),
    onTap: vi.fn(),
    stageName: 'Main Stage',
    stageColor: '#ff3366',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    moveMock.value = null;
    pickSyncMock.sync = undefined;
    festivalStoreState.allProfiles = [];
    crewStoreState.crewMembers = [];
    setStatusMock.mockReturnValue({
      status: 'later',
      label: '2:00 PM',
      minutesUntil: 300,
      progress: 0,
    });
    mockPicks(null);
  });

  it('renders an 8-artist B2B set as eight name buttons in a wrapping line', () => {
    const artists = ['Ana', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal'].map((name) => ({ name }));
    render(<SetCard {...defaultProps} set={makeSet({ artist: artists.map((a) => a.name).join(' b2b '), artists })} />);
    const line = document.querySelector('.card-artist')!;
    expect(line.querySelectorAll('button')).toHaveLength(8);
    expect(line).toHaveTextContent('Ana b2b Bo b2b Cy b2b Di b2b Ed b2b Flo b2b Gus b2b Hal');
    expect(line.className).toContain('break-words');
  });

  it('shows the moved chip and reads the old slot in the accessible name', () => {
    moveMock.value = { chip: 'Moved', line: 'Moved from Sat 10:00 PM, Sahara', a11y: 'Moved from Saturday 10:00 PM, Sahara' };
    render(<SetCard {...defaultProps} />);
    expect(screen.getByTestId('set-moved-chip')).toHaveTextContent('Moved');
    expect(screen.getByRole('button', { name: /, Moved from Saturday 10:00 PM, Sahara$/ })).toBeInTheDocument();
  });

  it('shows a Late cue only for a set that starts after midnight', () => {
    const { rerender } = render(
      <SetCard {...defaultProps} set={makeSet({ startTime: '01:00', endTime: '02:00', date: '2026-09-04' })} />,
    );
    expect(screen.getByText('Late')).toBeInTheDocument();
    rerender(<SetCard {...defaultProps} set={makeSet({ date: '2026-09-04' })} />);
    expect(screen.queryByText('Late')).toBeNull();
  });

  describe('artist name', () => {
    beforeEach(() => useArtistSheetStore.setState({ target: null, isOpen: false }));

    it('opens the artist sheet without opening the set, with or without set times', async () => {
      for (const times of [{}, { startTime: '', endTime: '' }]) {
        const onTap = vi.fn();
        useArtistSheetStore.setState({ target: null, isOpen: false });
        const { unmount } = render(
          <SetCard {...defaultProps} onTap={onTap} set={makeSet({ artists: [{ name: 'Daft Punk', genres: ['house'] }], ...times })} />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Open Daft Punk' }));
        expect(useArtistSheetStore.getState().isOpen).toBe(true);
        expect(useArtistSheetStore.getState().target?.artists[0]).toMatchObject({ name: 'Daft Punk', genres: ['house'] });
        expect(onTap).not.toHaveBeenCalled();
        unmount();
      }
    });

    it('still opens the set from the card body', async () => {
      const onTap = vi.fn();
      render(<SetCard {...defaultProps} onTap={onTap} />);
      await userEvent.click(screen.getByRole('button', { name: /^Daft Punk — Main Stage/ }));
      expect(onTap).toHaveBeenCalledTimes(1);
      expect(useArtistSheetStore.getState().isOpen).toBe(false);
    });

    it('gives each B2B artist its own button and sheet', async () => {
      const set = makeSet({ artist: 'Ana b2b Bo', artists: [{ name: 'Ana' }, { name: 'Bo', links: { spotify: 'https://open.spotify.com/b' } }] });
      render(<SetCard {...defaultProps} set={set} />);
      await userEvent.click(screen.getByRole('button', { name: 'Open Bo' }));
      expect(useArtistSheetStore.getState().target).toMatchObject({ title: 'Bo', artists: [{ name: 'Bo' }] });
      await userEvent.click(screen.getByRole('button', { name: 'Open Ana' }));
      expect(useArtistSheetStore.getState().target?.title).toBe('Ana');
    });
  });

  it('hides the moved chip when the set has no fresh move', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.queryByTestId('set-moved-chip')).toBeNull();
  });

  it('re-renders when movedAt changes', () => {
    const { rerender } = render(<SetCard {...defaultProps} />);
    expect(screen.queryByTestId('set-moved-chip')).toBeNull();
    moveMock.value = { chip: 'Moved', line: 'Moved', a11y: 'Moved' };
    rerender(<SetCard {...defaultProps} set={makeSet({ movedAt: '2026-01-02T00:00:00Z' })} />);
    expect(screen.getByTestId('set-moved-chip')).toBeInTheDocument();
  });

  it('renders the artist name', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
  });

  it('renders the stage name', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.getByText('Main Stage')).toBeInTheDocument();
  });

  it('renders the time range', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.getByText('2:00 PM - 3:00 PM')).toBeInTheDocument();
  });

  it('renders TBA when times are missing', () => {
    render(
      <SetCard
        {...defaultProps}
        set={makeSet({ startTime: undefined as unknown as string, endTime: undefined as unknown as string })}
      />,
    );
    expect(screen.getByText('TBA')).toBeInTheDocument();
  });

  it('transitions the translate property the hover lift writes, with no will-change', () => {
    render(<SetCard {...defaultProps} />);
    const cls = screen.getByTestId('set-card').className;
    expect(cls).toContain('transition-[background-color,box-shadow,translate]');
    expect(cls).not.toContain('will-change');
    expect(cls.match(/(^|\s)transition-/g)).toHaveLength(1);
  });

  it('moves the spotlight without a React render, only for a fine hover pointer', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const matchMedia = vi.fn((q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList);
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      render(<SetCard {...defaultProps} />);
      const card = screen.getByTestId('set-card');
      fireEvent.mouseMove(card, { clientX: 10, clientY: 20 });
      expect(matchMedia).toHaveBeenCalledWith('(hover: hover) and (pointer: fine)');
      frames.at(-1)!(0);
      expect(card.style.getPropertyValue('--mx')).toBe('10px');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('has data-testid="set-card"', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.getByTestId('set-card')).toBeInTheDocument();
  });

  it('has data-artist attribute with artist name', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.getByTestId('set-card')).toHaveAttribute('data-artist', 'Daft Punk');
  });

  it('calls onTap when the card click target is clicked', async () => {
    const onTap = vi.fn();
    const user = userEvent.setup();
    render(<SetCard {...defaultProps} onTap={onTap} />);
    const clickTarget = screen.getByLabelText(/Daft Punk.*Main Stage/);
    await user.click(clickTarget);
    expect(onTap).toHaveBeenCalledOnce();
  });

  it('renders the accessible click target with artist and stage info', () => {
    render(<SetCard {...defaultProps} />);
    const btn = screen.getByLabelText(/Daft Punk.*Main Stage.*2:00 PM/);
    expect(btn).toBeInTheDocument();
  });

  describe('Listen', () => {
    const spotifySet = makeSet({
      artists: [{ name: 'Daft Punk', links: { spotify: 'https://open.spotify.com/artist/abc123' } }],
    } as unknown as Partial<FestivalSet>);

    it('calls onPreview and never fetches', async () => {
      const onPreview = vi.fn();
      const onTap = vi.fn();
      render(<SetCard {...defaultProps} set={spotifySet} onPreview={onPreview} onTap={onTap} />);
      await userEvent.click(screen.getByRole('button', { name: 'Listen to Daft Punk' }));
      expect(onPreview).toHaveBeenCalledOnce();
      expect(onTap).not.toHaveBeenCalled();
      expect(api.get).not.toHaveBeenCalled();
    });

    it('is hidden without a Spotify artist link', () => {
      render(<SetCard {...defaultProps} />);
      expect(screen.queryByRole('button', { name: /Listen to/ })).not.toBeInTheDocument();
    });
  });

  describe('pick placeholders', () => {
    it('renders three placeholders while picks load', () => {
      const { container } = render(<SetCard {...defaultProps} showPicks={false} picksLoading />);
      expect(container.querySelectorAll('.skeleton-shimmer')).toHaveLength(3);
      expect(container.querySelector('.card-priority')).toBeNull();
    });

    it('renders no placeholders when not loading', () => {
      const { container } = render(<SetCard {...defaultProps} showPicks={false} />);
      expect(container.querySelectorAll('.skeleton-shimmer')).toHaveLength(0);
    });
  });

  describe('priority buttons', () => {
    it('renders 3 priority buttons when showPicks is true', () => {
      render(<SetCard {...defaultProps} showPicks />);
      expect(screen.getByLabelText('Must See: Daft Punk')).toBeInTheDocument();
      expect(screen.getByLabelText('Want to See: Daft Punk')).toBeInTheDocument();
      expect(screen.getByLabelText('Maybe: Daft Punk')).toBeInTheDocument();
    });

    it('shows the Must, Want and Maybe words', () => {
      render(<SetCard {...defaultProps} showPicks />);
      expect(screen.getByText('Must')).toBeInTheDocument();
      expect(screen.getByText('Want')).toBeInTheDocument();
      expect(screen.getByText('Maybe')).toBeInTheDocument();
    });

    it('names the priority group after the artist', () => {
      render(<SetCard {...defaultProps} showPicks />);
      expect(screen.getByRole('group', { name: 'Priority for Daft Punk' })).toBeInTheDocument();
    });

    it('does not render priority buttons when showPicks is false', () => {
      render(<SetCard {...defaultProps} showPicks={false} />);
      expect(screen.queryByLabelText('Must See: Daft Punk')).not.toBeInTheDocument();
    });

    it('marks the active priority with aria-pressed=true', () => {
      mockPicks('must');
      render(<SetCard {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Must See: Daft Punk' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Want to See: Daft Punk' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByRole('button', { name: /\(selected\)/ })).not.toBeInTheDocument();
    });

    it('draws a must pick as a coral outline, never a coral fill (filled coral is for SOS)', () => {
      mockPicks('must');
      render(<SetCard {...defaultProps} />);
      const must = screen.getByRole('button', { name: 'Must See: Daft Punk' });
      expect(must).toHaveClass('border-priority-must');
      expect(must).not.toHaveClass('bg-accent-coral-strong');
    });

    it('clears through usePickClear when the active priority is clicked', async () => {
      mockPicks('must');
      clearPickMock.mockClear();
      render(<SetCard {...defaultProps} />);
      await userEvent.click(screen.getByLabelText('Must See: Daft Punk'));
      expect(clearPickMock).toHaveBeenCalledWith('set-1', 'Daft Punk');
    });
  });

  describe('compact pick control on a touch-first device', () => {
    const touch = () => {
      vi.mocked(window.matchMedia).mockImplementation(
        (query: string) => ({ matches: query.includes('pointer: coarse'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
      );
    };
    afterEach(() => {
      vi.mocked(window.matchMedia).mockImplementation(
        (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
      );
    });

    it('shows one control and no trio until it is tapped', () => {
      touch();
      render(<SetCard {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Set priority for Daft Punk' })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByLabelText('Must See: Daft Punk')).not.toBeInTheDocument();
    });

    it('sets Must in two taps and collapses to the chosen state', async () => {
      touch();
      const savePick = vi.fn();
      vi.mocked(usePicks).mockReturnValue({ getMyPick: vi.fn(() => null), savePick, getMyNote: vi.fn(() => '') } as unknown as ReturnType<typeof usePicks>);
      render(<SetCard {...defaultProps} />);
      await userEvent.click(screen.getByRole('button', { name: 'Set priority for Daft Punk' }));
      await userEvent.click(screen.getByLabelText('Must See: Daft Punk'));
      expect(savePick).toHaveBeenCalledWith('fest-1', 'set-1', 'must');
      expect(screen.queryByLabelText('Must See: Daft Punk')).not.toBeInTheDocument();
    });

    it('names the chosen state on the collapsed control', () => {
      touch();
      mockPicks('want-to-see');
      render(<SetCard {...defaultProps} />);
      const toggle = screen.getByRole('button', { name: /^Want to See: Daft Punk\. Change priority$/ });
      expect(toggle).toHaveTextContent('Want');
    });

    it('collapses on Escape', async () => {
      touch();
      render(<SetCard {...defaultProps} />);
      await userEvent.click(screen.getByRole('button', { name: 'Set priority for Daft Punk' }));
      await userEvent.keyboard('{Escape}');
      expect(screen.getByRole('button', { name: 'Set priority for Daft Punk' })).toHaveFocus();
    });
  });

  describe('priority class', () => {
    it('adds priority-must class when pick is must', () => {
      mockPicks('must');
      render(<SetCard {...defaultProps} />);
      expect(screen.getByTestId('set-card').className).toContain('priority-must');
    });

    it('adds no priority class when no pick', () => {
      render(<SetCard {...defaultProps} />);
      expect(screen.getByTestId('set-card').className).not.toContain('priority-');
    });
  });

  describe('conflict badge', () => {
    it('renders the given clash label', () => {
      render(<SetCard {...defaultProps} clashLabel="Clashes with Chris Lake (30 min)" />);
      expect(screen.getByTestId('set-card').className).toContain('has-conflict');
      expect(screen.getByText('Clashes with Chris Lake (30 min)')).toBeInTheDocument();
      expect(screen.getByTestId('set-card').querySelectorAll('[data-clash-hatch]')).toHaveLength(1);
      expect(screen.getByTestId('set-card').querySelector('svg.lucide-triangle-alert')).toBeNull();
    });

    it('renders no badge when clashLabel is empty', () => {
      render(<SetCard {...defaultProps} clashLabel="" />);
      expect(screen.getByTestId('set-card').className).not.toContain('has-conflict');
    });

    it('re-renders when only clashLabel changes', () => {
      const { rerender } = render(<SetCard {...defaultProps} clashLabel="Clashes with A (10 min)" />);
      rerender(<SetCard {...defaultProps} clashLabel="Clashes with B (20 min)" />);
      expect(screen.getByText('Clashes with B (20 min)')).toBeInTheDocument();
    });
  });

  describe('crew overlap', () => {
    it('renders crew avatars with an accessible count label when crew data is present', () => {
      render(
        <SetCard
          {...defaultProps}
          friendProfiles={[
            { profileId: 'p1', name: 'Alice', priority: 'must' },
            { profileId: 'p2', name: 'Bob', priority: 'maybe' },
          ]}
        />,
      );
      // Avatars replace the bare count; the accessible label still conveys the count.
      expect(screen.getByLabelText(/2 crew members going to Daft Punk/)).toBeInTheDocument();
      // Initials avatars render for each crew member (no avatar image provided).
      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.getByText('B')).toBeInTheDocument();
    });

    it('opens the set when the crew avatars are tapped', async () => {
      const onTap = vi.fn();
      const user = userEvent.setup();
      render(<SetCard {...defaultProps} onTap={onTap} friendProfiles={[{ profileId: 'p1', name: 'Alice', priority: 'must' }]} />);
      await user.click(screen.getByLabelText(/1 crew member going to Daft Punk/));
      expect(onTap).toHaveBeenCalledOnce();
    });

    it('uses singular phrasing in the accessible label for a single friend', () => {
      render(<SetCard {...defaultProps} friendProfiles={[{ profileId: 'p1', name: 'Alice', priority: 'must' }]} />);
      expect(screen.getByLabelText(/1 crew member going to Daft Punk/)).toBeInTheDocument();
    });

    it('shows a +N overflow chip when more than 3 crew members are going', () => {
      render(
        <SetCard
          {...defaultProps}
          friendProfiles={[
            { profileId: 'p1', name: 'Alice', priority: 'must' },
            { profileId: 'p2', name: 'Bob', priority: 'maybe' },
            { profileId: 'p3', name: 'Carol', priority: 'want-to-see' },
            { profileId: 'p4', name: 'Dave', priority: 'maybe' },
            { profileId: 'p5', name: 'Eve', priority: 'maybe' },
          ]}
        />,
      );
      expect(screen.getByText('+2')).toBeInTheDocument();
      expect(screen.getByLabelText(/5 crew members going to Daft Punk/)).toBeInTheDocument();
    });

    it('groups avatars by priority (must before want before maybe) in the cluster', () => {
      // Provide friends out of priority order with distinct initials; the cluster
      // should re-sort so must (A) renders before want (B) before maybe (C).
      const { container } = render(
        <SetCard
          {...defaultProps}
          friendProfiles={[
            { profileId: 'p1', name: 'Cara', priority: 'maybe' },
            { profileId: 'p2', name: 'Bea', priority: 'want-to-see' },
            { profileId: 'p3', name: 'Ada', priority: 'must' },
          ]}
        />,
      );
      const text = container.querySelector('.card-overlap')?.textContent ?? '';
      // Visible initials sequence reflects must → want → maybe ordering.
      expect(text.indexOf('A')).toBeLessThan(text.indexOf('B'));
      expect(text.indexOf('B')).toBeLessThan(text.indexOf('C'));
    });

    it('summarizes the priority breakdown in the accessible label', () => {
      render(
        <SetCard
          {...defaultProps}
          friendProfiles={[
            { profileId: 'p1', name: 'Alice', priority: 'must' },
            { profileId: 'p2', name: 'Bob', priority: 'must' },
            { profileId: 'p3', name: 'Carol', priority: 'maybe' },
          ]}
        />,
      );
      // "N of your crew have this as a must" surfaces as a must/maybe breakdown
      // appended to the count label.
      expect(screen.getByLabelText(/3 crew members going to Daft Punk — 2 must, 1 maybe/)).toBeInTheDocument();
    });

    it('joins crew-member avatars by userId, falling back to initials', () => {
      // Profile p1 -> user u1 -> crew member with an avatar image; p2 has no
      // matching crew member, so it falls back to initials.
      festivalStoreState.allProfiles = [
        { id: 'p1', userId: 'u1' },
        { id: 'p2', userId: 'u2' },
      ];
      crewStoreState.crewMembers = [{ userId: 'u1', name: 'Alice' }];
      const { container } = render(
        <SetCard
          {...defaultProps}
          friendProfiles={[
            { profileId: 'p1', avatarUrl: 'https://cdn/alice.png', priority: 'must' },
            { profileId: 'p2', name: 'Bob', priority: 'maybe' },
          ]}
        />,
      );
      // Alice's avatar comes from friendProfiles.avatarUrl; name is joined
      // from the crew roster for the alt text.
      const img = container.querySelector('img[alt="Alice"]');
      expect(img).toHaveAttribute('src', 'https://cdn/alice.png');
      // Bob has no crew-member match and no avatarUrl -> initials fallback.
      expect(screen.getByText('B')).toBeInTheDocument();
    });

    it('falls back to the count when crew profiles have no identity data', () => {
      render(
        <SetCard
          {...defaultProps}
          friendProfiles={[
            { profileId: 'p1', priority: 'must' },
            { profileId: 'p2', priority: 'maybe' },
          ]}
        />,
      );
      expect(screen.getByText('2 going')).toBeInTheDocument();
    });

    it('hides crew overlap when no friendProfiles', () => {
      render(<SetCard {...defaultProps} friendProfiles={[]} />);
      expect(screen.queryByText(/going/)).not.toBeInTheDocument();
    });
  });

  describe('live badge', () => {
    it('shows LiveBadge when status is live', () => {
      setStatusMock.mockReturnValue({
        status: 'live',
        label: 'LIVE',
        minutesUntil: -10,
        progress: 0.5,
      });
      render(<SetCard {...defaultProps} />);
      expect(screen.getByTestId('live-badge')).toBeInTheDocument();
    });

    it('shows LiveBadge when status is soon', () => {
      setStatusMock.mockReturnValue({
        status: 'soon',
        label: 'In 15m',
        minutesUntil: 15,
        progress: 0,
      });
      render(<SetCard {...defaultProps} />);
      expect(screen.getByTestId('live-badge')).toBeInTheDocument();
    });

    it('does not show LiveBadge when status is later', () => {
      setStatusMock.mockReturnValue({
        status: 'later',
        label: '6:00 PM',
        minutesUntil: 300,
        progress: 0,
      });
      render(<SetCard {...defaultProps} />);
      expect(screen.queryByTestId('live-badge')).not.toBeInTheDocument();
    });
  });

  it('renders note indicator when user has a note', () => {
    mockPicks(null, 'My note');
    render(<SetCard {...defaultProps} />);
    // role=img: aria-label is prohibited on a bare span (axe aria-prohibited-attr).
    expect(screen.getByRole('img', { name: 'Has note' })).toBeInTheDocument();
  });

  it('does not render note indicator when no note', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.queryByLabelText('Has note')).not.toBeInTheDocument();
  });

  it('paints the stage colour as a rail and names the stage in primary text', () => {
    render(<SetCard {...defaultProps} stageColor="#00ff00" />);
    expect(screen.getByTestId('set-card-rail').style.background).toBe('rgb(0, 255, 0)');
    expect(screen.getByText('Main Stage')).toHaveClass('text-text-primary');
  });

  it('leads with the time in tabular numerals, above the stage and the artist', () => {
    render(<SetCard {...defaultProps} />);
    const time = screen.getByText('2:00 PM - 3:00 PM').parentElement!;
    expect(time).toHaveClass('tabular-nums');
    const order = [time, document.querySelector('.card-stage')!, document.querySelector('.card-artist')!];
    order.slice(1).forEach((el, i) => expect(order[i]!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
  });

  it('keeps Listen an icon button with its name', () => {
    const spotify = makeSet({ artists: [{ name: 'Daft Punk', links: { spotify: 'https://open.spotify.com/artist/abc123' } }] } as unknown as Partial<FestivalSet>);
    render(<SetCard {...defaultProps} set={spotify} />);
    expect(screen.getByRole('button', { name: 'Listen to Daft Punk' })).not.toHaveTextContent('Listen');
  });

  describe('past-set dimming', () => {
    const iso = (offsetDays: number) => {
      const d = new Date(Date.now() + offsetDays * 86_400_000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const setPhase = (start: number, end: number) => {
      festivalStoreState.currentFestival = { id: 'fest-1', startDate: iso(start), endDate: iso(end) };
    };
    const renderPast = () => {
      setStatusMock.mockReturnValue({ status: 'past', label: 'Ended', minutesUntil: -60, progress: 0 });
      render(<SetCard {...defaultProps} />);
      return {
        artist: document.querySelector('.card-artist') as HTMLElement,
        stage: document.querySelector('.card-stage') as HTMLElement,
      };
    };

    it('dims a past set tonally while the festival is live', () => {
      setPhase(-1, 1);
      const { artist, stage } = renderPast();
      expect(artist).toHaveClass('text-text-secondary');
      expect(stage).toHaveClass('text-text-secondary');
      expect(screen.getByTestId('set-card-rail').style.background).toBe('var(--color-overlay-3)');
    });

    it('marks an ended set with an Ended chip and swaps a pick for Rate while the festival is live', () => {
      setPhase(-1, 1);
      mockPicks('must');
      renderPast();
      expect(within(screen.getByTestId('set-card')).getByText('Ended')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Rate Daft Punk' })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: /Priority for/ })).not.toBeInTheDocument();
    });

    it('shows no Ended chip when the festival is not live', () => {
      setPhase(-3, -2);
      renderPast();
      expect(screen.queryByText('Ended')).not.toBeInTheDocument();
    });

    it.each([
      ['upcoming', 2, 3],
      ['fully past', -3, -2],
    ])('does not dim a past set when the festival is %s', (_name, start, end) => {
      setPhase(start, end);
      const { artist, stage } = renderPast();
      expect(artist).toHaveClass('text-text-primary');
      expect(stage).toHaveClass('text-text-primary');
      expect(screen.getByTestId('set-card-rail').style.background).toBe('rgb(255, 51, 102)');
    });
  });

  describe('pick save state', () => {
    const mustPicked = () =>
      mockPicks('must');

    it.each(['saving', 'queued'])('shows the clock while %s', (state) => {
      mustPicked();
      pickSyncMock.sync = { state, priority: 'must' };
      render(<SetCard {...defaultProps} />);
      expect(screen.getByTestId('pick-pending-clock')).toBeInTheDocument();
    });

    it('shows no clock when synced', () => {
      mustPicked();
      render(<SetCard {...defaultProps} />);
      expect(screen.queryByTestId('pick-pending-clock')).not.toBeInTheDocument();
    });

    it('shows Retry for a failed pick and calls retry', async () => {
      pickSyncMock.sync = { state: 'failed', priority: 'must' };
      render(<SetCard {...defaultProps} />);
      expect(screen.getByText('Pick not saved.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(pickSyncMock.retry).toHaveBeenCalledTimes(1);
    });
  });
});
