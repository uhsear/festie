import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockStatus: { kind: string; label: string } | null = null;
let mockOffline = false;
let mockCachedAt: number | null = null;
vi.mock('@festie/shared/hooks', () => ({ useSaveStatus: () => mockStatus }));
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: (sel: (s: { offlineMode: boolean }) => unknown) => sel({ offlineMode: mockOffline }),
}));
vi.mock('@festie/shared/stores/festivalDataStore', () => ({
  useFestivalDataStore: (sel: (s: { _festivalCachedAt: number | null }) => unknown) => sel({ _festivalCachedAt: mockCachedAt }),
}));

import ScheduleStatusLine from './ScheduleStatusLine';

describe('ScheduleStatusLine', () => {
  it.each([
    ['saved', 'Saved'],
    ['saving', 'Saving…'],
    ['syncing', 'Syncing…'],
    ['offline', 'Offline, will sync'],
    ['failed', 'Not saved'],
  ])('renders %s', (kind, label) => {
    mockStatus = { kind, label };
    mockCachedAt = null;
    render(<ScheduleStatusLine showFreshness />);
    expect(screen.getByRole('status')).toHaveTextContent(label);
  });

  it('merges freshness and save state into one status line', () => {
    mockStatus = { kind: 'saved', label: 'Saved' };
    mockCachedAt = Date.now();
    mockOffline = false;
    render(<ScheduleStatusLine showFreshness />);
    const line = screen.getByTestId('schedule-status-line');
    expect(line).toHaveTextContent('Updated just now');
    expect(line).toHaveTextContent('Saved');
    // Only the save state is a live region: the minute-by-minute freshness text must not be announced.
    const live = screen.getAllByRole('status');
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveTextContent('Saved');
    expect(live[0]).not.toHaveTextContent('Updated');
  });

  it('keeps the offline-ready note and the pending-sync state while offline', () => {
    mockStatus = { kind: 'offline', label: 'Offline, will sync' };
    mockCachedAt = Date.now();
    mockOffline = true;
    render(<ScheduleStatusLine showFreshness />);
    expect(screen.getByTestId('schedule-status-line')).toHaveTextContent('Updated just now · Offline-ready');
    expect(screen.getByRole('status')).toHaveTextContent('Offline, will sync');
    mockOffline = false;
  });

  it('hides freshness off the schedule routes', () => {
    mockStatus = null;
    mockCachedAt = Date.now();
    render(<ScheduleStatusLine showFreshness={false} />);
    expect(screen.getByTestId('schedule-status-line')).not.toHaveTextContent('Updated');
  });

  it('keeps its fixed height when idle, so Saved appearing shifts nothing', () => {
    mockStatus = null;
    mockCachedAt = null;
    const idle = render(<ScheduleStatusLine showFreshness />);
    expect(screen.getByTestId('schedule-status-line')).toHaveClass('h-6');
    expect(screen.getByTestId('schedule-status-line')).toHaveTextContent('');
    idle.unmount();
    mockStatus = { kind: 'saved', label: 'Saved' };
    render(<ScheduleStatusLine showFreshness />);
    expect(screen.getByTestId('schedule-status-line')).toHaveClass('h-6');
  });
});
