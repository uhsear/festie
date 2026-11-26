import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithQueryClient } from '../test-utils';
import CaughtPage from './caught';

const mocks = vi.hoisted(() => ({
  wrap: null as unknown,
  fail: false as boolean | 'notFound',
  current: { id: 'f1' } as { id: string } | null,
  search: { festival: 'f1' } as { festival?: string },
  markCaught: vi.fn(async () => ({})),
}));

vi.mock('@tanstack/react-router', () => ({ useSearch: () => mocks.search }));
vi.mock('@festie/shared/services', () => {
  const load = async () => {
    if (mocks.fail === 'notFound') throw Object.assign(new Error('not found'), { status: 404 });
    if (mocks.fail) throw new Error('boom');
    return JSON.parse(JSON.stringify(mocks.wrap));
  };
  return {
    api: { get: vi.fn(load) },
    fetchWrap: vi.fn(load),
    isApiClientError: (e: unknown) => !!e && typeof e === 'object' && 'status' in e,
    markCaught: mocks.markCaught,
  };
});
vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toastError: vi.fn() }) }));
vi.mock('@festie/shared/stores', () => {
  const state = {
    user: { id: 'u1' },
    get currentFestival() {
      return mocks.current;
    },
    sets: [
      { id: 'x1', artist: 'Zebra Band', stageId: 'st1', dayIndex: 0, date: '2020-04-24', startTime: '20:00', endTime: '21:00' },
      { id: 'a', artist: 'Artist A', stageId: 'st1', dayIndex: 0, date: '2020-04-24', startTime: '18:00', endTime: '19:00' },
    ],
    days: [{ date: '2020-04-24', label: 'Friday' }],
    stages: [{ id: 'st1', name: 'Main', festivalId: 'f1' }],
  };
  const hook = (sel: (s: typeof state) => unknown) => sel(state);
  return { useFestivalStore: hook, useAuthStore: hook };
});
vi.mock('../components/features/RatingButtons', () => ({
  default: ({ onRated, showCaption }: { onRated?: (n: number) => void; showCaption?: boolean }) => (
    <button type="button" data-show-caption={String(showCaption)} onClick={() => onRated?.(5)}>
      rate-five
    </button>
  ),
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
    <div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {cta && <button onClick={cta.onClick}>{cta.label}</button>}
    </div>
  ),
}));
vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const festival = { id: 'f1', name: 'Past Fest', timeZone: 'UTC', days: [{ date: '2020-04-24', label: 'Friday' }] };
const planned = (over: Record<string, unknown>) => ({
  setId: 'a',
  artist: 'Artist A',
  stageId: 'st1',
  stageName: 'Main',
  dayIndex: 0,
  startTime: '18:00',
  endTime: '19:00',
  rating: null,
  note: null,
  caught: null,
  ...over,
});
const future = { ...festival, id: 'f1', days: [{ date: '2999-04-24', label: 'Friday' }] };

function renderPage() {
  return renderWithQueryClient(<CaughtPage />);
}

describe('CaughtPage', () => {
  beforeEach(() => {
    mocks.fail = false;
    mocks.current = { id: 'f1' };
    mocks.search = { festival: 'f1' };
    mocks.markCaught.mockClear();
    mocks.wrap = {
      festival,
      planned: [planned({}), planned({ setId: 'b', artist: 'Artist B', dayIndex: 1, startTime: '19:00', caught: true })],
      caughtExtra: [],
    };
  });

  it('groups sets by day with headings and a count line', async () => {
    mocks.wrap = { festival, planned: [planned({ caught: true }), planned({ setId: 'c', artist: 'C', caught: false })] };
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Friday' })).toBeInTheDocument();
    expect(screen.getByText('1 seen · 1 missed')).toBeInTheDocument();
  });

  it('toggles Saw it and Missed it through markCaught', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Saw it, Artist A' }));
    expect(mocks.markCaught).toHaveBeenLastCalledWith('a', true, 'u1');
    expect(screen.getByRole('button', { name: 'Saw it, Artist A' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Saw it, Artist A' }));
    expect(mocks.markCaught).toHaveBeenLastCalledWith('a', null, 'u1');
    fireEvent.click(screen.getByRole('button', { name: 'Missed it Artist A' }));
    expect(mocks.markCaught).toHaveBeenLastCalledWith('a', false, 'u1');
  });

  it('says the festival has not started, with no list or add button, for an upcoming festival', async () => {
    mocks.wrap = { festival: future, planned: [planned({})] };
    renderPage();
    expect(await screen.findByText("The festival hasn't started")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Saw it, Artist A' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a set I caught' })).toBeNull();
  });

  it('says the festival is not found on a 404', async () => {
    mocks.fail = 'notFound';
    renderPage();
    expect(await screen.findByText('Festival not found')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your sets")).toBeNull();
  });

  it('shows the rating scale only after Saw it, and prints the caption once for the page', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Saw it, Artist A' });
    // Artist B is already marked seen, Artist A is not.
    expect(screen.getAllByText('rate-five')).toHaveLength(1);
    expect(screen.getAllByText('Tap to rate this set')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Saw it, Artist A' }));
    const scales = screen.getAllByText('rate-five');
    expect(scales).toHaveLength(2);
    for (const scale of scales) expect(scale).toHaveAttribute('data-show-caption', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Missed it Artist A' }));
    expect(screen.getAllByText('rate-five')).toHaveLength(1);
  });

  it('marks a set as seen when it is rated', async () => {
    mocks.wrap = { festival, planned: [planned({ caught: false })], caughtExtra: [] };
    renderPage();
    await screen.findByRole('button', { name: 'Saw it, Artist A' });
    expect(screen.queryByText('rate-five')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Saw it, Artist A' }));
    fireEvent.click(screen.getByText('rate-five'));
    expect(mocks.markCaught).toHaveBeenCalledWith('a', true, 'u1');
  });

  it('adds a set from the lineup and removes it again', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a set I caught' }));
    fireEvent.change(screen.getByLabelText('Search the lineup'), { target: { value: 'zebra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Zebra Band' }));
    expect(mocks.markCaught).toHaveBeenLastCalledWith('x1', true, 'u1');
    const row = screen.getByText('Zebra Band').closest('li')!;
    expect(within(row).getByText('Added')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Remove Zebra Band' }));
    expect(mocks.markCaught).toHaveBeenLastCalledWith('x1', null, 'u1');
    expect(screen.queryByText('Added')).toBeNull();
  });

  it('shows the empty state and still offers the add section', async () => {
    mocks.wrap = { festival, planned: [] };
    renderPage();
    expect(await screen.findByText('Nothing to check off yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a set I caught' })).toBeInTheDocument();
  });

  it('shows a retry action when the load fails', async () => {
    mocks.fail = true;
    renderPage();
    expect(await screen.findByText("Couldn't load your sets")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('asks for a festival when none is chosen', () => {
    mocks.search = {};
    mocks.current = null;
    renderPage();
    expect(screen.getByText('Choose a festival first.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a set I caught' })).toBeNull();
  });
});
