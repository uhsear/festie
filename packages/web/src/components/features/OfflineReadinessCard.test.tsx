import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import OfflineReadinessCard from './OfflineReadinessCard';
import { buildOfflineSteps, summarizeOffline } from '@festie/shared/utils';
import type { FestivalPhase } from '@festie/shared/utils';

const h = vi.hoisted(() => ({
  state: null as unknown as Record<string, unknown>,
  download: vi.fn(),
}));

vi.mock('../../hooks/useOfflineDownload', () => ({
  useOfflineDownload: () => ({ ...h.state, download: h.download }),
}));

type Sec = { status: 'idle' | 'syncing' | 'ready' | 'error'; syncedAt: number | null };
const idle: Sec = { status: 'idle', syncedAt: null };
const ready: Sec = { status: 'ready', syncedAt: Date.now() };

function setState(
  sections: Partial<Record<'schedule' | 'picks' | 'crew' | 'weather' | 'art', Sec>>,
  opts: { map?: Sec | null; mapDetail?: string; phase?: FestivalPhase | null; mapBytes?: number | null } = {},
) {
  const full = { schedule: idle, picks: idle, crew: idle, weather: idle, art: idle, ...sections };
  const steps = buildOfflineSteps(full, { hasCrew: true, map: opts.map ?? null, mapDetail: opts.mapDetail });
  h.state = {
    steps,
    summary: summarizeOffline(steps, opts.phase ?? 'pre'),
    isDownloading: steps.some((s) => s.section.status === 'syncing'),
    mapBytes: opts.mapBytes ?? null,
    hasMap: !!opts.map,
  };
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Show offline download details' }));

describe('OfflineReadinessCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setState({});
  });

  it('is one collapsed line by default with a Download button', () => {
    render(<OfflineReadinessCard festivalId="fest-1" />);
    expect(screen.getByText('Download for offline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show offline download details' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Weather')).not.toBeInTheDocument();
  });

  it('opens the checklist with the no-map description and Not saved rows', () => {
    render(<OfflineReadinessCard festivalId="fest-1" />);
    open();
    expect(screen.getByText(/The map needs signal at this festival\./)).toBeInTheDocument();
    expect(screen.getAllByText('Not saved').length).toBeGreaterThan(0);
    const list = screen.getByRole('list', { name: 'Offline readiness checklist' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
  });

  it('shows the map row, size and coral detail when the festival has a map', () => {
    setState({}, { map: { status: 'error', syncedAt: 1 }, mapDetail: 'Not enough space for the map (4 MB). Free up space, then retry.', mapBytes: 4_200_000 });
    render(<OfflineReadinessCard festivalId="fest-1" />);
    open();
    expect(screen.getByText('Offline map')).toBeInTheDocument();
    expect(screen.getByText(/festival map so they work with no signal\. The map is 4 MB\./)).toBeInTheDocument();
    expect(screen.getByText(/Not enough space for the map/)).toHaveClass('text-accent-coral');
  });

  it('reads Available offline and Update when everything is ready', () => {
    setState({ schedule: ready, picks: ready, crew: ready, weather: ready, art: ready });
    render(<OfflineReadinessCard festivalId="fest-1" />);
    expect(screen.getByText(/Available offline · synced/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
  });

  it('shows a Retry action for a partial download and retries from a failed row', () => {
    setState({ schedule: ready, picks: ready, crew: ready, art: ready, weather: { status: 'error', syncedAt: null } });
    render(<OfflineReadinessCard festivalId="fest-1" />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    open();
    fireEvent.click(screen.getByRole('button', { name: /retry weather/i }));
    expect(h.download).toHaveBeenCalledTimes(1);
  });

  it('calls download from the action button', () => {
    render(<OfflineReadinessCard festivalId="fest-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(h.download).toHaveBeenCalledTimes(1);
  });

  it('disables the action and sets aria-busy while syncing', () => {
    setState({ schedule: { status: 'syncing', syncedAt: null } });
    render(<OfflineReadinessCard festivalId="fest-1" />);
    const btn = screen.getByRole('button', { name: 'Downloading…' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('renders nothing for a past festival with nothing saved', () => {
    setState({}, { phase: 'post' });
    const { container } = render(<OfflineReadinessCard festivalId="fest-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
