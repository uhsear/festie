import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RateNightBanner from './RateNightBanner';

const mocks = vi.hoisted(() => ({ toRate: [] as unknown[], phase: 'post' as string | null }));

vi.mock('@tanstack/react-router', () => ({
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
vi.mock('@festie/shared/services', () => ({
  api: { get: vi.fn(async () => ({ planned: [], festival: { id: 'f1', days: [] } })) },
}));
vi.mock('@festie/shared/stores', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1' } }),
  useFestivalStore: (sel: (s: unknown) => unknown) => sel({ currentFestival: { id: 'f1', name: 'Fest' }, days: [] }),
}));
vi.mock('@festie/shared/utils', () => ({
  festivalPhase: () => mocks.phase,
  selectSetsToRate: () => mocks.toRate,
}));

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RateNightBanner />
    </QueryClientProvider>,
  );
}

describe('RateNightBanner', () => {
  beforeEach(() => {
    mocks.toRate = [];
    mocks.phase = 'post';
  });

  it('renders nothing when no set is left to rate', async () => {
    const { container } = renderBanner();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count and links to the rate screen', async () => {
    mocks.toRate = [{}, {}];
    renderBanner();
    expect(await screen.findByText('2 sets to rate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rate now' })).toHaveAttribute('href', '/rate?festival=f1');
  });

  it('stays hidden before the festival starts', async () => {
    mocks.toRate = [{}];
    mocks.phase = 'pre';
    const { container } = renderBanner();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
