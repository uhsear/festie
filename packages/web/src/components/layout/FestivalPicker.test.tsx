import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FestivalPicker from './FestivalPicker';

interface TestFestival {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  location?: string;
  slug?: string | null;
}

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const state = {
  festivals: [] as TestFestival[],
  currentFestival: null as { id: string; name: string } | null,
  selectFestival: vi.fn(async (_id: string) => {}),
  isLoading: false,
};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: typeof state) => unknown) => selector(state),
  useAuthStore: (selector: (s: { user: null }) => unknown) => selector({ user: null }),
  useFollowStore: Object.assign(
    (selector: (s: { festivalIds: string[]; loaded: boolean }) => unknown) =>
      selector({ festivalIds: [], loaded: true }),
    { getState: () => ({ load: vi.fn(async () => {}), setFollowing: vi.fn(async () => {}) }) },
  ),
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ href: '/' }),
}));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: toastMock, toastError: vi.fn() }),
}));

const fest = (id: string, name: string, start: number, end: number, location?: string): TestFestival => ({
  id,
  name,
  startDate: day(start),
  endDate: day(end),
  location,
});

afterEach(() => {
  state.festivals = [];
  state.currentFestival = null;
  state.isLoading = false;
  vi.clearAllMocks();
});

describe('FestivalPicker trigger', () => {
  it('shows the current festival name', () => {
    state.currentFestival = { id: 'a', name: 'Alpha Fest' };
    render(<FestivalPicker />);
    const trigger = screen.getByTestId('festival-select');
    expect(trigger).toHaveTextContent('Alpha Fest');
    expect(trigger).toHaveAttribute('data-festival-id', 'a');
    expect(trigger).toHaveAttribute('aria-label', 'Festival: Alpha Fest. Change festival');
  });

  it('shows a placeholder while loading and "Choose a festival" after', () => {
    state.isLoading = true;
    const { unmount, container } = render(<FestivalPicker />);
    expect(container.querySelector('.skeleton-shimmer')).toBeInTheDocument();
    expect(screen.queryByText('Select Festival')).not.toBeInTheDocument();
    unmount();
    state.isLoading = false;
    render(<FestivalPicker />);
    expect(screen.getByTestId('festival-select')).toHaveTextContent('Choose a festival');
  });
});

describe('FestivalPicker dialog', () => {
  it('groups festivals in order with dates and place, and marks the current one', () => {
    state.festivals = [
      fest('past', 'Past Fest', -30, -28, 'Orlando'),
      fest('up', 'Upcoming Fest', 20, 22, 'Miami'),
      fest('live', 'Live Fest', -1, 1, 'Tampa'),
    ];
    state.currentFestival = { id: 'live', name: 'Live Fest' };
    render(<FestivalPicker />);
    fireEvent.click(screen.getByTestId('festival-select'));
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Live now', 'Upcoming', 'Past']);
    expect(screen.getByTestId('festival-option-up')).toHaveTextContent('Miami');
    expect(screen.getByTestId('festival-option-up')).toHaveTextContent(' · ');
    expect(screen.getByTestId('festival-option-live')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('festival-option-past')).not.toHaveAttribute('aria-current');
  });

  it('shows search only above 8 festivals and filters by name or location', () => {
    state.festivals = Array.from({ length: 8 }, (_, i) => fest(`f${i}`, `Fest ${i}`, 10 + i, 12 + i));
    const { unmount } = render(<FestivalPicker />);
    fireEvent.click(screen.getByTestId('festival-select'));
    expect(screen.queryByLabelText('Search festivals')).not.toBeInTheDocument();
    unmount();

    state.festivals.push(fest('f8', 'Needle', 30, 31, 'Haystack City'));
    render(<FestivalPicker />);
    fireEvent.click(screen.getByTestId('festival-select'));
    fireEvent.change(screen.getByLabelText('Search festivals'), { target: { value: 'haystack' } });
    expect(screen.getByTestId('festival-option-f8')).toBeInTheDocument();
    expect(screen.queryByTestId('festival-option-f0')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search festivals'), { target: { value: 'zzz' } });
    expect(screen.getByText('No festival matches "zzz".')).toBeInTheDocument();
  });

  it('calls selectFestival and closes when a row is chosen', async () => {
    state.festivals = [fest('a', 'Alpha', 5, 6), fest('b', 'Beta', 8, 9)];
    render(<FestivalPicker />);
    fireEvent.click(screen.getByTestId('festival-select'));
    fireEvent.click(screen.getByTestId('festival-option-b'));
    expect(state.selectFestival).toHaveBeenCalledWith('b');
    await waitFor(() => expect(screen.queryByTestId('festival-option-b')).not.toBeInTheDocument());
  });

  it('says "No festivals yet." for an empty loaded list', () => {
    render(<FestivalPicker />);
    fireEvent.click(screen.getByTestId('festival-select'));
    expect(screen.getByText('No festivals yet.')).toBeInTheDocument();
  });
});

describe('FestivalPicker share', () => {
  const withSlug = (f: TestFestival, slug: string | null): TestFestival => ({ ...f, slug });
  const open = () => {
    render(<FestivalPicker />);
    fireEvent.click(screen.getByTestId('festival-select'));
  };
  const setNav = (share: unknown, writeText?: unknown) => {
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  };
  afterEach(() => setNav(undefined, undefined));

  it('renders Share only for festivals with a slug, on every group, without selecting', () => {
    state.festivals = [
      withSlug(fest('live', 'Live Fest', -1, 1), 'live-fest'),
      withSlug(fest('past', 'Past Fest', -30, -28), 'past-fest'),
      withSlug(fest('up', 'Upcoming Fest', 20, 22), null),
    ];
    open();
    expect(screen.getByLabelText('Share Live Fest')).toBeInTheDocument();
    expect(screen.getByLabelText('Share Past Fest')).toBeInTheDocument();
    expect(screen.queryByLabelText('Share Upcoming Fest')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Share Live Fest'));
    expect(state.selectFestival).not.toHaveBeenCalled();
  });

  it('uses navigator.share with title, text and the /f/ url; AbortError shows no toast', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('x', 'AbortError'));
    setNav(share, vi.fn());
    state.festivals = [withSlug(fest('a', 'Alpha', 5, 6), 'alpha')];
    open();
    fireEvent.click(screen.getByLabelText('Share Alpha'));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        title: 'Alpha',
        text: 'Alpha lineup and set times on Festie',
        url: `${window.location.origin}/f/alpha`,
      }),
    );
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('copies the link without navigator.share and toasts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNav(undefined, writeText);
    state.festivals = [withSlug(fest('a', 'Alpha', 5, 6), 'alpha')];
    open();
    fireEvent.click(screen.getByLabelText('Share Alpha'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/f/alpha`));
    expect(toastMock).toHaveBeenCalledWith('Link copied', 'success');
  });

  it('toasts the failure string when the clipboard rejects', async () => {
    setNav(undefined, vi.fn().mockRejectedValue(new Error('no')));
    state.festivals = [withSlug(fest('a', 'Alpha', 5, 6), 'alpha')];
    open();
    fireEvent.click(screen.getByLabelText('Share Alpha'));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith("Couldn't share this festival. Try again.", 'error'));
  });
});
