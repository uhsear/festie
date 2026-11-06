import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  navigate: vi.fn(),
  search: { festival: 'past1' } as { festival?: string },
  cards: [] as unknown[],
  toRate: [] as unknown[],
  summarizePlan: vi.fn(() => ({ planned: 0, mustSees: 0, stages: 0, days: 0, hours: 0, clashes: [] })),
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mocks.search,
  useNavigate: () => mocks.navigate,
  Link: ({ to, search, children, ...rest }: { to: string; search?: Record<string, string>; children: React.ReactNode }) => (
    <a href={search ? `${to}?${new URLSearchParams(search).toString()}` : to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@festie/shared/services', () => ({ api: { get: mocks.get } }));
vi.mock('@festie/shared/stores', () => {
  const state = {
    user: { id: 'u1', username: 'asir' },
    currentFestival: { id: 'cur', name: 'Current Fest' },
    activeCrew: null,
    selectCrew: vi.fn(),
    wrapShowHandle: true,
    setWrapShowHandle: vi.fn(),
  };
  const hook = (sel: (s: typeof state) => unknown) => sel(state);
  return { useAuthStore: hook, useFestivalStore: hook, useCrewStore: hook, useUIStore: hook };
});
vi.mock('@festie/shared/utils', async (orig) => ({
  artistOf: (await orig<typeof import('@festie/shared/utils')>()).artistOf,
  sortRatingsForWrap: (await orig<typeof import('@festie/shared/utils')>()).sortRatingsForWrap,
  buildWrapCards: () => mocks.cards,
  isWrapUnlocked: () => true,
  selectSetsToRate: () => mocks.toRate,
  summarizePlan: mocks.summarizePlan,
  wrapByline: () => null,
}));
vi.mock('../components/features/GuestTeaser', () => ({ default: () => null }));
vi.mock('../components/ui/skeletons/WrapSkeleton', () => ({ default: () => <div>loading</div> }));
vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/wrap/WrapCarousel', () => ({ default: () => <div>carousel</div> }));
vi.mock('../components/wrap/WrapHero', () => ({ default: () => null }));
vi.mock('../components/crew/CrewPhotosCard', () => ({ default: () => null }));
vi.mock('../hooks/useRovingTabs', () => ({ useRovingTabs: () => undefined }));
vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));

import WrapPage from './wrap';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WrapPage />
    </QueryClientProvider>,
  );
}

const response = {
  stats: { totalRated: 0, avgRating: null, stagesVisited: 0, daysAttended: 0, totalHours: 0 },
  topSets: [],
  allRatings: [],
  festival: { id: 'past1', name: 'Past Fest', timeZone: null, days: [] },
  planned: [],
  crew: null,
};

describe('WrapPage', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.get.mockResolvedValue(response);
    mocks.navigate.mockReset();
    mocks.search = { festival: 'past1' };
    mocks.cards = [];
    mocks.toRate = [];
    mocks.summarizePlan.mockClear();
  });

  it('requests the wrap of the festival in the search param', async () => {
    renderPage();
    await screen.findByText('Nothing to wrap yet');
    expect(mocks.get).toHaveBeenCalledWith('/ratings/wrap/past1');
  });

  it('falls back to the current festival without a search param', async () => {
    mocks.search = {};
    renderPage();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/ratings/wrap/cur'));
  });

  it('sends the empty-state CTA to the lineup', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open the lineup' }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('links the still-to-rate prompt to /rate for that festival', async () => {
    mocks.cards = [{ kind: 'plan', kicker: 'YOUR PLAN', headline: '2 sets planned' }];
    mocks.toRate = [{ setId: 'a' }, { setId: 'b' }];
    renderPage();
    expect(await screen.findByText('2 sets still to rate')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Rate your night' }).getAttribute('href')).toBe('/rate?festival=past1');
  });

  it('links the What you caught list and counts added sets in the hero', async () => {
    mocks.cards = [{ kind: 'plan', kicker: 'YOUR PLAN', headline: '2 sets planned' }];
    const extra = [{ setId: 'x', caught: true }];
    mocks.get.mockResolvedValue({ ...response, planned: [{ setId: 'a' }], caughtExtra: extra });
    renderPage();
    expect((await screen.findByRole('link', { name: 'What you caught' })).getAttribute('href')).toBe(
      '/caught?festival=past1',
    );
    expect(mocks.summarizePlan).toHaveBeenCalledWith([{ setId: 'a' }], extra);
  });

  it('labels the handle switch with its row text', async () => {
    mocks.cards = [{ kind: 'plan', kicker: 'YOUR PLAN', headline: '2 sets planned' }];
    renderPage();
    const sw = await screen.findByRole('switch', { name: 'Show @asir on cards' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });
});
