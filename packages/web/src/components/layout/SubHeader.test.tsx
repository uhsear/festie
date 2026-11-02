import { fireEvent, render, screen } from '@testing-library/react';
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
  searchQuery: '',
  setSelectedDay: vi.fn(),
  setActiveStages: vi.fn(),
  setSearchQuery: vi.fn(),
  // My picks toggle: gated on currentProfile + currentFestival.
  currentProfile: { id: 'p1' } as { id: string } | null,
  onlyMine: false,
  setOnlyMine: vi.fn(),
  isLoading: false,
};
const authState = { user: { id: 'u1' } as { id: string } | null };

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

vi.mock('@festie/shared/hooks', () => ({
  useFestival: () => ({ getStageColor: () => '#00e8d0' }),
  useSaveStatus: () => ({ kind: 'saved', label: 'Saved' }),
}));

let mockPathname = '/cards';
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: mockPathname }),
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
    expect(screen.getByRole('button', { name: 'Day: Fri, May 29' })).toBeInTheDocument();
  });

  it('hides day tabs and search when festivalOnly is set (behavior preserved)', () => {
    render(<SubHeader dayOnly={true} festivalOnly={true} />);
    expect(screen.queryByRole('group', { name: 'Festival days' })).not.toBeInTheDocument();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });

  it('shows search box only when not dayOnly/festivalOnly', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByRole('search')).toBeInTheDocument();
  });
});

describe('SubHeader My picks toggle', () => {
  afterEach(() => {
    // Restore the default state mutated by the tests below.
    storeState.currentProfile = { id: 'p1' };
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
    storeState.currentProfile = { id: 'p1' };
    storeState.isLoading = false;
    vi.clearAllMocks();
  });

  it('shows the date beside the label and puts it in the aria-label', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const chip = screen.getByRole('button', { name: 'Day: Fri, May 29' });
    expect(chip).toHaveTextContent('FriMay 29');
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

  it('shows the active-filter summary on Timeline (no chips there) and clears it', () => {
    storeState.activeStages = ['s2'];
    mockPathname = '/timeline';
    render(<SubHeader dayOnly={true} festivalOnly={false} />);
    expect(screen.queryByRole('button', { name: 'Forest' })).not.toBeInTheDocument();
    // Timeline/Grid have no fold buttons, so the summary must stay visible on phones.
    expect(screen.getByTestId('stage-filter-summary').closest('[class~="max-md:hidden"]')).toBeNull();
    fireEvent.click(screen.getByTestId('stage-filter-summary'));
    expect(storeState.setActiveStages).toHaveBeenCalledWith([]);
  });

  it('hides the summary when no stage filter is active and on /picks', () => {
    mockPathname = '/timeline';
    const { unmount } = render(<SubHeader dayOnly={true} festivalOnly={false} />);
    expect(screen.queryByTestId('stage-filter-summary')).not.toBeInTheDocument();
    unmount();
    storeState.activeStages = ['s2'];
    mockPathname = '/picks';
    render(<SubHeader dayOnly={true} festivalOnly={false} />);
    expect(screen.queryByTestId('stage-filter-summary')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show only my picks' })).not.toBeInTheDocument();
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
});

describe('SubHeader save status chip', () => {
  it('mounts for a signed-in profile and not for a guest', () => {
    const { unmount } = render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByTestId('save-status-chip')).toBeInTheDocument();
    unmount();
    const prev = storeState.currentProfile;
    storeState.currentProfile = null;
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.queryByTestId('save-status-chip')).not.toBeInTheDocument();
    storeState.currentProfile = prev;
  });
});

describe('SubHeader phone fold', () => {
  afterEach(() => {
    storeState.searchQuery = '';
    mockPathname = '/cards';
  });

  it('renders collapsed Search and Filters buttons and folds the filters', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('subheader-filters')).toHaveClass('max-md:hidden');
  });

  it('opens the filters when Filters is clicked', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('subheader-filters')).not.toHaveClass('max-md:hidden');
  });

  it('opens and focuses the search input when Search is clicked', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(document.getElementById('subheader-search')).toHaveClass('max-md:hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(document.getElementById('subheader-search')).not.toHaveClass('max-md:hidden');
    expect(screen.getByLabelText('Search festival artists')).toHaveFocus();
  });

  it('keeps search open and counts it in Filters when a query is set', () => {
    storeState.searchQuery = 'foo';
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(document.getElementById('subheader-search')).not.toHaveClass('max-md:hidden');
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();
  });

  it('renders neither button on /picks', () => {
    mockPathname = '/picks';
    render(<SubHeader dayOnly={true} festivalOnly={false} />);
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Filters/ })).not.toBeInTheDocument();
  });
});
