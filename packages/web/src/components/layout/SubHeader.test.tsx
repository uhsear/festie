import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SubHeader from './SubHeader';

// Minimal store state used by SubHeader. Selectors are applied against this.
const storeState = {
  festivals: [{ id: 'f1', name: 'Festival One' }],
  currentFestival: { id: 'f1', name: 'Festival One' },
  selectFestival: vi.fn(),
  stages: [
    { id: 's1', name: 'Main Stage' },
    { id: 's2', name: 'Forest' },
    { id: 's3', name: 'Dome' },
  ],
  days: [
    { id: 'd1', label: 'Fri', date: '2026-05-29' },
    { id: 'd2', label: 'Sat', date: '2026-05-30' },
  ],
  selectedDay: 0,
  activeStages: [] as string[],
  activeGenres: [] as string[],
  setActiveGenres: vi.fn(),
  sets: [] as unknown[],
  searchQuery: '',
  setSelectedDay: vi.fn(),
  setActiveStages: vi.fn(),
  setSearchQuery: vi.fn(),
  // My picks toggle: gated on currentProfile + currentFestival.
  currentProfile: { id: 'p1', picks: { set1: 'must' } } as { id: string; picks: Record<string, string> } | null,
  onlyMine: false,
  setOnlyMine: vi.fn(),
  isLoading: false,
  hiddenDays: [] as number[],
  setHiddenDays: vi.fn(),
  scheduleView: null as string | null,
  setScheduleView: vi.fn(),
  scheduleGroupBy: 'time',
  setScheduleGroupBy: vi.fn(),
};
const authState = { user: { id: 'u1' } as { id: string } | null };

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

vi.mock('@festie/shared/hooks', () => ({
  useFestival: () => ({ getStageColor: () => '#00e8d0', getFilteredSets: () => [] }),
  useSaveStatus: () => ({ kind: 'saved', label: 'Saved' }),
  useViewAs: () => ({ target: null, canView: () => false, start: vi.fn(), clear: vi.fn() }),
}));

let mockPathname = '/cards';
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: mockPathname }),
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../../hooks/useSwipeDays', () => ({
  useSwipeDays: () => ({ bind: () => ({}) }),
}));

vi.mock('../../hooks/useHaptics', () => ({
  useHaptics: () => ({ select: vi.fn() }),
}));

vi.mock('../../hooks/useScrollFade', () => ({
  useScrollFade: () => ({ ref: { current: null }, canScrollLeft: false, canScrollRight: false }),
}));
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }),
}));

function getNav() {
  return document.querySelector('nav.sub-header') as HTMLElement;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SubHeader layout density', () => {
  it('renders the festival selector and view controls nav', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByTestId('festival-select')).toBeInTheDocument();
    expect(getNav()).toBeInTheDocument();
  });

  it('labels an ongoing festival "Happening now"', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-29T18:00:00'));
    try {
      render(<SubHeader dayOnly={false} festivalOnly={false} />);
      expect(screen.getByTestId('festival-status-pill')).toHaveTextContent('Happening now');
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies compact horizontal rhythm on small widths and comfortable on desktop', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const nav = getNav();
    // Compact (mobile-first) defaults use the space-3 token.
    expect(nav.className).toContain('px-[var(--space-3)]');
    expect(nav.className).toContain('gap-[var(--space-3)]');
    // Comfortable desktop overrides behind the sm: breakpoint.
    expect(nav.className).toContain('sm:px-6');
    expect(nav.className).toContain('sm:gap-[var(--space-6)]');
  });

  it('keeps day tabs visible with consistent space-3 gap', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const tabs = screen.getByRole('group', { name: 'Festival days' });
    expect(tabs.className).toContain('gap-[var(--space-3)]');
    expect(screen.getByRole('button', { name: 'Fri May 29' })).toBeInTheDocument();
  });

  it('paints the active day with a fill and no glow, because the scroller clips a shadow to a rectangle', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const active = within(screen.getByRole('group', { name: 'Festival days' })).getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'true')!;
    expect(active.className).toContain('bg-day-tab-active');
    expect(active.className).not.toMatch(/shadow-/);
  });

  it('hides day tabs and search when festivalOnly is set (behavior preserved)', () => {
    render(<SubHeader dayOnly={true} festivalOnly={true} />);
    expect(screen.queryByRole('group', { name: 'Festival days' })).not.toBeInTheDocument();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });

  it.each(['/map', '/caught', '/rate'])('renders the festival picker alone on %s', (path) => {
    mockPathname = path;
    const { container } = render(<SubHeader dayOnly={false} festivalOnly={true} />);
    expect(container.querySelector('nav[aria-label="Festival view controls"]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'Festival days' })).not.toBeInTheDocument();
    mockPathname = '/cards';
  });

  it('shows search box only when not dayOnly/festivalOnly', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByRole('search')).toBeInTheDocument();
  });
});

describe('SubHeader My picks toggle', () => {
  afterEach(() => {
    // Restore the default state mutated by the tests below.
    storeState.currentProfile = { id: 'p1', picks: { set1: 'must' } };
    storeState.currentFestival = { id: 'f1', name: 'Festival One' };
    storeState.onlyMine = false;
    vi.clearAllMocks();
  });

  it('renders the My picks toggle when currentProfile + currentFestival are present', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByRole('button', { name: 'Show only my picks' })).toBeInTheDocument();
  });

  it('hides the My picks toggle when there is no profile', () => {
    storeState.currentProfile = null;
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.queryByRole('button', { name: 'Show only my picks' })).not.toBeInTheDocument();
  });

  it('calls setOnlyMine(!onlyMine) when the toggle is clicked', () => {
    storeState.onlyMine = false;
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    screen.getByRole('button', { name: 'Show only my picks' }).click();
    expect(storeState.setOnlyMine).toHaveBeenCalledWith(true);
  });

  it('toggles back off when already showing only my picks', () => {
    storeState.onlyMine = true;
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const btn = screen.getByRole('button', { name: 'Show only my picks' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    btn.click();
    expect(storeState.setOnlyMine).toHaveBeenCalledWith(false);
  });
});

describe('SubHeader day chips and picks placeholder', () => {
  afterEach(() => {
    storeState.currentProfile = { id: 'p1', picks: {} };
    storeState.isLoading = false;
    vi.clearAllMocks();
  });

  it('shows the date beside the label and names the chip by its visible text', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const chip = screen.getByRole('button', { name: 'Fri May 29' });
    expect(chip).toHaveTextContent('Fri May 29');
    expect(chip).not.toHaveAttribute('aria-label');
  });

  it('holds the My picks place with a placeholder while the profile loads', () => {
    storeState.currentProfile = null;
    storeState.isLoading = true;
    const { container } = render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.queryByRole('button', { name: 'Show only my picks' })).not.toBeInTheDocument();
    expect(container.querySelector('.skeleton-shimmer.w-\\[104px\\]')).toBeInTheDocument();
  });
});

describe('SubHeader stage chips', () => {
  afterEach(() => {
    storeState.activeStages = [];
    mockPathname = '/cards';
    vi.clearAllMocks();
  });

  it('treats "All stages" as the pressed state when nothing is selected', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByRole('button', { name: 'All stages' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Forest' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('narrows to only the tapped stage from the all-stages state', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forest' }));
    expect(storeState.setActiveStages).toHaveBeenCalledWith(['s2']);
  });

  it('adds a stage to an existing selection and returns to all stages when emptied', () => {
    storeState.activeStages = ['s2'];
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dome' }));
    expect(storeState.setActiveStages).toHaveBeenLastCalledWith(['s2', 's3']);
    fireEvent.click(screen.getByRole('button', { name: 'Forest' }));
    expect(storeState.setActiveStages).toHaveBeenLastCalledWith([]);
  });

  it('"All stages" clears the selection', () => {
    storeState.activeStages = ['s2'];
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'All stages' }));
    expect(storeState.setActiveStages).toHaveBeenCalledWith([]);
  });

  it('shows the search box and stage chips on Grid', () => {
    mockPathname = '/grid';
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All stages' })).toBeInTheDocument();
  });

  it('toggles chips through toggleStageFilter', () => {
    storeState.activeStages = ['s1'];
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dome' }));
    expect(storeState.setActiveStages).toHaveBeenCalledWith(['s1', 's3']);
  });
});

describe('SubHeader search clear button', () => {
  afterEach(() => {
    storeState.searchQuery = '';
  });

  it('appears only with a query and empties it', () => {
    const { unmount } = render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    unmount();
    storeState.searchQuery = 'foo';
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(storeState.setSearchQuery).toHaveBeenCalledWith('');
    expect(screen.getByLabelText('Search festival artists')).toHaveFocus();
  });
});

describe('SubHeader guarded My picks and hidden days', () => {
  afterEach(() => {
    storeState.currentProfile = { id: 'p1', picks: { set1: 'must' } };
    storeState.hiddenDays = [];
    storeState.selectedDay = 0;
    mockPathname = '/cards';
  });

  it('reads "Pick a set first" and ignores clicks when there are no picks', () => {
    storeState.currentProfile = { id: 'p1', picks: {} };
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const chip = screen.getByText('Pick a set first').closest('button') as HTMLElement;
    expect(chip).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(chip);
    expect(storeState.setOnlyMine).not.toHaveBeenCalled();
  });

  it('drops a hidden day tab on /cards and offers "+1 hidden"; /picks shows every day', () => {
    storeState.hiddenDays = [0];
    storeState.selectedDay = 1;
    const { unmount } = render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.queryByRole('button', { name: 'Fri May 29' })).not.toBeInTheDocument();
    expect(screen.getByText('+1 hidden')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+1 hidden day, show all' }));
    expect(storeState.setHiddenDays).toHaveBeenCalledWith([]);
    unmount();
    mockPathname = '/picks';
    render(<SubHeader dayOnly={true} festivalOnly={false} />);
    expect(screen.getByRole('button', { name: 'Fri May 29' })).toBeInTheDocument();
  });
});

describe('SubHeader My picks scope', () => {
  afterEach(() => {
    mockPathname = '/cards';
  });

  it.each(['/compare', '/wrap', '/crew-plan', '/picks'])('hides My picks on %s, which ignore the filter', (path) => {
    mockPathname = path;
    render(<SubHeader dayOnly={true} festivalOnly={false} />);
    expect(screen.queryByRole('button', { name: 'Show only my picks' })).not.toBeInTheDocument();
  });

  it.each(['/', '/cards', '/timeline', '/grid'])('shows My picks on %s', (path) => {
    mockPathname = path;
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByRole('button', { name: 'Show only my picks' })).toBeInTheDocument();
  });
});

describe('SubHeader route scope', () => {
  afterEach(() => {
    mockPathname = '/cards';
  });

  it.each(['/admin', '/does-not-exist'])('renders no schedule controls on %s', (path) => {
    mockPathname = path;
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.queryByTestId('festival-select')).not.toBeInTheDocument();
  });

  it('shows only the festival name as the page title on /festival-mode', () => {
    mockPathname = '/festival-mode';
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Festival One' })).toBeInTheDocument();
    expect(screen.queryByTestId('festival-select')).not.toBeInTheDocument();
  });

  it('puts the festival clock beside the /festival-mode title, in the page column', () => {
    mockPathname = '/festival-mode';
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const title = screen.getByTestId('festival-mode-title');
    expect(screen.getByLabelText('Festival time')).toHaveTextContent(/\d:\d\d/);
    // One flex row holds both, and it uses the same column widths as the page below it.
    expect(title.parentElement).toContainElement(screen.getByLabelText('Festival time'));
    expect(title.parentElement).toHaveClass('max-w-[560px]', 'lg:max-w-5xl', 'mx-auto');
    expect(title.parentElement?.parentElement).toHaveClass('px-6');
  });
});

describe('SubHeader status line', () => {
  it('mounts the one status line on schedule routes, for guests too', () => {
    const { unmount } = render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByTestId('schedule-status-line')).toBeInTheDocument();
    unmount();
    const prev = storeState.currentProfile;
    storeState.currentProfile = null;
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByTestId('schedule-status-line')).toBeInTheDocument();
    storeState.currentProfile = prev;
  });
});

describe('SubHeader phone fold', () => {
  afterEach(() => {
    storeState.searchQuery = '';
    mockPathname = '/cards';
  });

  it('renders one collapsed Filters button, no separate Search button, and folds the filters', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('subheader-filters')).toHaveClass('max-md:hidden');
  });

  it('opens the filters when Filters is clicked', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('subheader-filters')).not.toHaveClass('max-md:hidden');
  });

  it('keeps the search box inside the folded filters, so Filters opens it', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(document.getElementById('subheader-filters')).toContainElement(document.getElementById('subheader-search'));
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(document.getElementById('subheader-filters')).not.toHaveClass('max-md:hidden');
  });

  it('counts a set query in Filters', () => {
    storeState.searchQuery = 'foo';
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();
  });

  it('lists the Cards and Grid view links in the first row, not a row of their own', () => {
    mockPathname = '/cards';
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const views = screen.getByRole('navigation', { name: 'Schedule view' });
    expect(getNav()).toContainElement(views);
    expect(screen.getByRole('link', { name: 'Cards' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders no view links on /picks', () => {
    mockPathname = '/picks';
    render(<SubHeader dayOnly={false} festivalOnly />);
    expect(screen.queryByRole('navigation', { name: 'Schedule view' })).not.toBeInTheDocument();
  });

  it('folds Group by into the filters on Cards, and picking Stage saves it', () => {
    mockPathname = '/cards';
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const filters = document.getElementById('subheader-filters') as HTMLElement;
    expect(filters).toContainElement(screen.getByRole('group', { name: 'Group by' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }));
    expect(storeState.setScheduleGroupBy).toHaveBeenCalledWith('stage');
  });

  it('offers no Group by on Grid', () => {
    mockPathname = '/grid';
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.queryByRole('group', { name: 'Group by' })).not.toBeInTheDocument();
  });

  it('renders no Filters button on /picks', () => {
    mockPathname = '/picks';
    render(<SubHeader dayOnly={true} festivalOnly={false} />);
    expect(screen.queryByRole('button', { name: /^Filters/ })).not.toBeInTheDocument();
  });
});

describe('SubHeader genre chips', () => {
  const genreSet = (id: string, genres: string[]) => ({ id, artists: [{ name: id, genres }] });
  const richSets = [
    genreSet('a', ['house', 'techno']),
    genreSet('b', ['house', 'techno']),
    genreSet('c', ['house', 'techno']),
  ];

  afterEach(() => {
    mockPathname = '/cards';
    storeState.sets = [];
    storeState.activeGenres = [];
  });

  it('hides the group when the festival has no genre data', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.queryByRole('group', { name: 'Filter by genre' })).not.toBeInTheDocument();
  });

  it('shows chips, toggles a genre and clears with All genres', () => {
    storeState.sets = richSets;
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const group = screen.getByRole('group', { name: 'Filter by genre' });
    expect(group).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'House' }));
    expect(storeState.setActiveGenres).toHaveBeenCalledWith(['house']);
    fireEvent.click(screen.getByRole('button', { name: 'All genres' }));
    expect(storeState.setActiveGenres).toHaveBeenCalledWith([]);
  });

  it('marks active genres pressed and counts them in Filters', () => {
    storeState.sets = richSets;
    storeState.activeGenres = ['house', 'techno'];
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByRole('button', { name: 'House' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All genres' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();
  });

  it('shows the Spotify attribution only when the genres come from Spotify artists', () => {
    const spotifyLink = 'https://open.spotify.com/artist/4gzpq5DPGxSnKTe4SA8HAU';
    storeState.sets = richSets;
    const { unmount } = render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.queryByTestId('spotify-attribution')).not.toBeInTheDocument();
    unmount();
    storeState.sets = richSets.map((set) => ({ ...set, artists: [{ ...set.artists[0], links: { spotify: spotifyLink } }] }));
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByTestId('spotify-attribution')).toHaveAttribute('href', spotifyLink);
  });

  it('hides the group on day-only routes where the stage chips hide', () => {
    storeState.sets = richSets;
    mockPathname = '/picks';
    render(<SubHeader dayOnly={true} festivalOnly={false} />);
    expect(screen.queryByRole('group', { name: 'Filter by genre' })).not.toBeInTheDocument();
  });
});

describe('SubHeader day chips', () => {
  it('press-scales through the shared utility, not a raw active:scale', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const chip = screen.getByRole('button', { name: 'Fri May 29' });
    expect(chip).toHaveClass('press-scale');
    expect(chip.className).not.toMatch(/active:scale/);
  });
});

describe('SubHeader desktop row plan', () => {
  const mkDays = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, label: `Day ${i + 1}`, date: `2026-05-${String(29 + i).padStart(2, '0')}` }));
  const mkStages = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `Stage ${i}` }));
  const original = { days: storeState.days, stages: storeState.stages };
  // The class list says which flex line an item joins: order 0 is row 1, the break is order 1, row 2 is order 2 and up.
  const orderAt = (el: Element, bp: 'md' | 'xl') => {
    const cls = el.className;
    if (bp === 'xl' && /(^|\s)xl:order-none(\s|$)/.test(cls)) return 0;
    const m = /(^|\s)md:order-(\d+)(\s|$)/.exec(cls);
    return m ? Number(m[2]) : 0;
  };

  afterEach(() => {
    storeState.days = original.days;
    storeState.stages = original.stages;
    mockPathname = '/cards';
  });

  it.each([
    ['many days, many stages', 7, 6],
    ['days only, two stages', 2, 2],
    ['one day, one stage', 1, 1],
  ])('puts the controls on row 1 and the stage chips on row 2 for %s', (_name, dayCount, stageCount) => {
    storeState.days = mkDays(dayCount);
    storeState.stages = mkStages(stageCount);
    render(<SubHeader dayOnly={false} festivalOnly={false} />);

    const rail = screen.getByRole('group', { name: 'Festival days' }).parentElement!;
    const search = screen.getByRole('search');
    const views = screen.getByRole('navigation', { name: 'Schedule view' });
    const groupBy = screen.getByRole('group', { name: 'Group by' });
    const stageChips = screen.getByRole('group', { name: 'Filter by stage' }).parentElement!;
    const myPicks = screen.getByRole('button', { name: 'Show only my picks' });
    const rowBreak = screen.getByTestId('subheader-row-break');

    // From xl: one row of picker, view switch, day rail, search and Group by.
    for (const el of [rail, search, views, groupBy]) expect(orderAt(el, 'xl')).toBe(0);
    // Between md and xl Group by drops to row 2 so row 1 keeps the day rail.
    expect(orderAt(groupBy, 'md')).toBe(2);
    for (const el of [rail, search, views]) expect(orderAt(el, 'md')).toBe(0);
    // Row 2 holds the stage chips and My picks at every desktop width, after one full-width break.
    expect(orderAt(rowBreak, 'md')).toBe(1);
    expect(rowBreak.className).toContain('md:basis-full');
    for (const bp of ['md', 'xl'] as const) {
      expect(orderAt(stageChips, bp)).toBe(2);
      expect(orderAt(myPicks, bp)).toBe(2);
    }
    // The rail has a small flex basis, so any number of days scrolls inside the row and never forces a wrap.
    expect(rail.className).toContain('md:flex-[1_1_8rem]');
    expect(stageChips.className).toContain('md:flex-[1_1_8rem]');
  });

  it.each([
    ['festival-only', true, false],
    ['day-only', false, true],
  ])('has no row break on a %s page, so no empty second row sits under the picker', (_name, festivalOnly, dayOnly) => {
    render(<SubHeader dayOnly={dayOnly} festivalOnly={festivalOnly} />);
    expect(screen.queryByTestId('subheader-row-break')).toBeNull();
  });

  it('leaves the phone path alone: the fold, the order-3 and order-4 wrappers and the full-width chips stay', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(document.getElementById('subheader-filters')).toHaveClass('max-md:order-4', 'max-md:hidden');
    expect(screen.getByRole('group', { name: 'Filter by stage' }).parentElement).toHaveClass('w-full');
    expect(screen.getByRole('group', { name: 'Festival days' }).parentElement).toHaveClass('max-md:flex-1');
  });
});
