import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HistorySection from './HistorySection';

const mocks = vi.hoisted(() => ({
  lifetime: {} as unknown,
  phase: 'post' as string | null,
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search?: Record<string, string>;
    children: React.ReactNode;
  }) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@festie/shared/services', () => ({ api: { get: vi.fn(async () => mocks.lifetime) } }));
vi.mock('@festie/shared/stores', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1' } }),
  useFestivalStore: (sel: (s: unknown) => unknown) =>
    sel({ currentFestival: { id: 'f9', name: 'Now Fest' }, days: [] }),
}));
vi.mock('@festie/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared/utils')>()),
  festivalPhase: () => mocks.phase,
}));
vi.mock('../ui/EmptyState', () => ({
  default: ({ title, cta }: { title: string; cta?: { label: string; onClick: () => void } }) => (
    <div>
      <h3>{title}</h3>
      {cta && <button onClick={cta.onClick}>{cta.label}</button>}
    </div>
  ),
}));

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HistorySection />
    </QueryClientProvider>,
  );
}

const totals = { totalRated: 3, avgRating: 4, festivalsAttended: 1, stagesVisited: 2, daysAttended: 2, totalHours: 5 };

describe('HistorySection', () => {
  beforeEach(() => {
    mocks.phase = 'post';
    mocks.navigate.mockClear();
  });

  it('links each festival row to that festival wrap', async () => {
    mocks.lifetime = {
      totals,
      byFestival: [
        {
          festivalId: 'f1',
          festivalName: 'Coachella',
          startDate: null,
          endDate: null,
          totalRated: 3,
          avgRating: 4,
          stagesVisited: 2,
          daysAttended: 2,
          totalHours: 5,
        },
      ],
      topArtists: [],
    };
    renderSection();
    const row = await screen.findByRole('link', { name: 'Open your Coachella wrap' });
    expect(row).toHaveAttribute('href', '/wrap?festival=f1');
  });

  it('offers a rate CTA in the empty state while the current festival is live or over', async () => {
    mocks.lifetime = { totals: { ...totals, totalRated: 0 }, byFestival: [], topArtists: [] };
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Rate sets from Now Fest' }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/rate', search: { festival: 'f9' } });
  });

  it('hides the empty-state CTA before the festival starts', async () => {
    mocks.phase = 'pre';
    mocks.lifetime = { totals: { ...totals, totalRated: 0 }, byFestival: [], topArtists: [] };
    renderSection();
    await screen.findByText('No festival history yet');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  describe('seen most', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ artist: `Artist ${i}`, festivals: 2 }));

    it('renders rows with festival counts', async () => {
      mocks.lifetime = { totals, byFestival: [], topArtists: [], seenMost: rows(2) };
      renderSection();
      expect(await screen.findByRole('heading', { name: "Artists you've seen most" })).toBeInTheDocument();
      expect(screen.getByRole('listitem', { name: 'Artist 0, 2 festivals' })).toBeInTheDocument();
      expect(screen.getAllByText('2 festivals')).toHaveLength(2);
    });

    it('caps at 5 rows', async () => {
      mocks.lifetime = { totals, byFestival: [], topArtists: [], seenMost: rows(8) };
      renderSection();
      expect(await screen.findAllByRole('listitem')).toHaveLength(5);
    });

    it('is absent when empty or missing', async () => {
      mocks.lifetime = { totals, byFestival: [], topArtists: [], seenMost: [] };
      const { unmount } = renderSection();
      await screen.findByText('Festivals');
      expect(screen.queryByText("Artists you've seen most")).not.toBeInTheDocument();
      unmount();
      mocks.lifetime = { totals, byFestival: [], topArtists: [] };
      renderSection();
      await screen.findByText('Festivals');
      expect(screen.queryByText("Artists you've seen most")).not.toBeInTheDocument();
    });

    it('shows under the empty state when nothing is rated', async () => {
      mocks.lifetime = { totals: { ...totals, totalRated: 0 }, byFestival: [], topArtists: [], seenMost: rows(1) };
      renderSection();
      expect(await screen.findByText('No festival history yet')).toBeInTheDocument();
      expect(screen.getByText('Artist 0')).toBeInTheDocument();
    });
  });
});
