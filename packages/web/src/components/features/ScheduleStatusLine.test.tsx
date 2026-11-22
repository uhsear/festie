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
    const lines = screen.getAllByRole('status');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('Updated just now');
    expect(lines[0]).toHaveTextContent('Saved');
  });

  it('keeps the offline-ready note and the pending-sync state while offline', () => {
    mockStatus = { kind: 'offline', label: 'Offline, will sync' };
    mockCachedAt = Date.now();
    mockOffline = true;
    render(<ScheduleStatusLine showFreshness />);
    expect(screen.getByRole('status')).toHaveTextContent('Updated just now · Offline-ready');
    expect(screen.getByRole('status')).toHaveTextContent('Offline, will sync');
    mockOffline = false;
  });

  it('hides freshness off the schedule routes', () => {
    mockStatus = null;
    mockCachedAt = Date.now();
    render(<ScheduleStatusLine showFreshness={false} />);
    expect(screen.getByRole('status')).not.toHaveTextContent('Updated');
  });

  it('keeps its fixed height when idle, so Saved appearing shifts nothing', () => {
    mockStatus = null;
    mockCachedAt = null;
    const idle = render(<ScheduleStatusLine showFreshness />);
    expect(screen.getByRole('status')).toHaveClass('h-6');
    expect(screen.getByRole('status')).toHaveTextContent('');
    idle.unmount();
    mockStatus = { kind: 'saved', label: 'Saved' };
    render(<ScheduleStatusLine showFreshness />);
    expect(screen.getByRole('status')).toHaveClass('h-6');
  });
});
