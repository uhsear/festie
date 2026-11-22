import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import OfflineReadinessCard from './OfflineReadinessCard';
import { buildOfflineSteps, summarizeOffline } from '@festie/shared/utils';
import type { FestivalPhase } from '@festie/shared/utils';

const h = vi.hoisted(() => ({
  state: null as unknown as Record<string, unknown>,
  download: vi.fn(),
  removeMap: vi.fn(),
}));

vi.mock('../../hooks/useOfflineDownload', () => ({
  useOfflineDownload: () => ({ ...h.state, download: h.download }),
}));

type Sec = { status: 'idle' | 'syncing' | 'ready' | 'error'; syncedAt: number | null };
const idle: Sec = { status: 'idle', syncedAt: null };
const ready: Sec = { status: 'ready', syncedAt: Date.now() };

function setState(
  sections: Partial<Record<'schedule' | 'picks' | 'crew' | 'weather' | 'art', Sec>>,
  opts: { map?: Sec | null; mapMessage?: string | null; phase?: FestivalPhase | null; mapBytes?: number | null; mapProgress?: number | null } = {},
) {
  const full = { schedule: idle, picks: idle, crew: idle, weather: idle, art: idle, ...sections };
  const steps = buildOfflineSteps(full, { hasCrew: true, map: opts.map ?? null });
  h.state = {
    mapProgress: opts.mapProgress ?? null,
    mapMessage: opts.mapMessage ?? null,
    mapReady: opts.map?.status === 'ready',
    removeMap: h.removeMap,
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

  it('shows the map row and size when the festival has a map', () => {
    setState({}, { map: { status: 'error', syncedAt: 1 }, mapBytes: 4_200_000 });
    render(<OfflineReadinessCard festivalId="fest-1" />);
    open();
    expect(screen.getByText('Offline map')).toBeInTheDocument();
    expect(screen.getByText(/festival map so they work with no signal\. The map is 4 MB\./)).toBeInTheDocument();
  });

  it('says why the map was not saved without opening the details', () => {
    const message = 'Not enough free space to save the map (needs 5 MB, 1 MB free). Free up some space and try again.';
    setState({}, { map: { status: 'error', syncedAt: 1 }, mapMessage: message, mapBytes: 4_200_000 });
    render(<OfflineReadinessCard festivalId="fest-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
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

  it('shows the map download percentage and a progress bar while it downloads', () => {
    setState({}, { map: { status: 'syncing', syncedAt: null }, mapProgress: 0.42 });
    render(<OfflineReadinessCard festivalId="fest-1" />);
    open();
    expect(screen.getByText(/Downloading the map: 42%/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Map download progress' })).toHaveAttribute('value', '0.42');
  });

  it('deletes the downloaded map only when one is stored', () => {
    setState({}, { map: { status: 'idle', syncedAt: null } });
    const { unmount } = render(<OfflineReadinessCard festivalId="fest-1" />);
    open();
    expect(screen.queryByRole('button', { name: 'Delete downloaded map' })).not.toBeInTheDocument();
    unmount();
    setState({}, { map: ready });
    render(<OfflineReadinessCard festivalId="fest-1" />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Delete downloaded map' }));
    expect(h.removeMap).toHaveBeenCalledTimes(1);
  });
});
