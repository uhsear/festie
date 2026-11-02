import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RatePage from './rate';

const mocks = vi.hoisted(() => ({
  toRate: [] as unknown[],
  unlocked: true,
  fail: false,
  markCaught: vi.fn(async () => ({})),
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ festival: 'f1' }),
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
    <a href={search ? `${to}?${new URLSearchParams(search).toString()}` : to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('motion/react', () => ({ useReducedMotion: () => true }));
vi.mock('@festie/shared/services', () => ({
  api: {
    get: vi.fn(async () => {
      if (mocks.fail) throw new Error('boom');
      return { planned: [], festival: { id: 'f1', days: [{ date: '2026-04-24', label: 'Friday' }] } };
    }),
  },
  markCaught: mocks.markCaught,
}));
vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toastError: vi.fn() }) }));
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: unknown) => unknown) => sel({ currentFestival: { id: 'f1' } }),
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1' } }),
}));
vi.mock('@festie/shared/utils', () => ({
  selectSetsToRate: () => mocks.toRate,
  isWrapUnlocked: () => mocks.unlocked,
  formatTime: (t: string) => t,
}));
vi.mock('../components/features/RatingButtons', () => ({
  default: ({ onRated }: { onRated?: (n: number) => void }) => (
    <button type="button" onClick={() => onRated?.(5)}>
      rate-five
    </button>
  ),
}));
vi.mock('../components/ui/EmptyState', () => ({
  default: ({ title, cta }: { title: string; cta?: { label: string; onClick: () => void } }) => (
    <div>
      <h2>{title}</h2>
      {cta && <button onClick={cta.onClick}>{cta.label}</button>}
    </div>
  ),
}));
vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const sets = [
  { setId: 'a', artist: 'Artist A', stageName: 'Main', dayIndex: 0, startTime: '21:00' },
  { setId: 'b', artist: 'Artist B', stageName: 'Tent', dayIndex: 0, startTime: '22:00' },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RatePage />
    </QueryClientProvider>,
  );
}

describe('RatePage', () => {
  beforeEach(() => {
    mocks.toRate = sets;
    mocks.unlocked = true;
    mocks.fail = false;
    mocks.markCaught.mockClear();
  });

  it('shows the first set with progress and meta', async () => {
    renderPage();
    expect(await screen.findByText('Artist A')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Main · Friday · 21:00')).toBeInTheDocument();
  });

  it('advances after a rating and finishes with the wrap link', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('rate-five'));
    expect(await screen.findByText('Artist B')).toBeInTheDocument();
    fireEvent.click(screen.getByText('rate-five'));
    expect(await screen.findByText('All rated')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your wrap' })).toHaveAttribute('href', '/wrap?festival=f1');
  });

  it('marks a rated set as seen', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('rate-five'));
    expect(mocks.markCaught).toHaveBeenCalledWith('a', true, 'u1');
  });

  it('Saw it marks the set without advancing, and Skipped marks it skipped and advances', async () => {
    renderPage();
    await screen.findByText('Artist A');
    fireEvent.click(screen.getByRole('button', { name: 'Saw it' }));
    expect(mocks.markCaught).toHaveBeenLastCalledWith('a', true, 'u1');
    expect(screen.getByRole('button', { name: 'Saw it' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Artist A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skipped' }));
    expect(mocks.markCaught).toHaveBeenLastCalledWith('a', false, 'u1');
    expect(screen.getByText('Artist B')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saw it' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('skip advances, and a festival that is not over links back to picks', async () => {
    mocks.unlocked = false;
    renderPage();
    await screen.findByText('Artist A');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByText('Artist B')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('link', { name: 'Back to picks' })).toHaveAttribute('href', '/picks');
  });

  it('shows the empty state when nothing needs rating', async () => {
    mocks.toRate = [];
    renderPage();
    expect(await screen.findByText('Nothing to rate right now')).toBeInTheDocument();
  });

  it('shows a retry action when the load fails', async () => {
    mocks.fail = true;
    renderPage();
    expect(await screen.findByText("Couldn't load your sets")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
