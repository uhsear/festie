import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OfflineStatusChip from './OfflineStatusChip';

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  festivalId: 'f1' as string | null,
  days: [] as { date: string }[],
  hook: { summary: { overall: 'none', hasDownloaded: false, lastSyncedAt: null, hidden: false }, isDownloading: false },
  download: vi.fn(),
}));

vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: h.user }),
}));
vi.mock('@festie/shared/stores/festivalStore', () => ({
  useFestivalStore: (sel: (s: unknown) => unknown) =>
    sel({ currentFestival: h.festivalId ? { id: h.festivalId, timeZone: 'UTC' } : null, days: h.days }),
}));
vi.mock('../../hooks/useOfflineDownload', () => ({
  useOfflineDownload: () => ({ ...h.hook, download: h.download }),
}));

function setHook(overall: string, extra: Record<string, unknown> = {}) {
  h.hook = {
    summary: { overall, hasDownloaded: overall !== 'none', lastSyncedAt: Date.now(), hidden: false, ...extra },
    isDownloading: overall === 'syncing',
  };
}

describe('OfflineStatusChip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.user = { id: 'u1' };
    h.festivalId = 'f1';
    h.days = [];
    setHook('none');
  });

  it('shows the day-before banner on the home from 18:00 festival time until the pack is ready', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    h.days = [{ date: '2026-11-10' }];
    vi.setSystemTime(Date.UTC(2026, 10, 9, 17, 59));
    const before = render(<OfflineStatusChip remind />);
    expect(before.queryByText(/Open Festie on wifi/)).toBeNull();
    before.unmount();
    vi.setSystemTime(Date.UTC(2026, 10, 9, 18, 0));
    const at = render(<OfflineStatusChip remind />);
    expect(at.getByText('Open Festie on wifi to save the map and lineup for no signal.')).toBeInTheDocument();
    at.unmount();
    const noRemind = render(<OfflineStatusChip />);
    expect(noRemind.queryByText(/Open Festie on wifi/)).toBeNull();
    noRemind.unmount();
    setHook('ready');
    const ready = render(<OfflineStatusChip remind />);
    expect(ready.queryByText(/Open Festie on wifi/)).toBeNull();
    vi.useRealTimers();
  });

  it('renders nothing for a guest, with no festival, or when hidden', () => {
    h.user = null;
    const a = render(<OfflineStatusChip />);
    expect(a.container).toBeEmptyDOMElement();
    h.user = { id: 'u1' };
    h.festivalId = null;
    const b = render(<OfflineStatusChip />);
    expect(b.container).toBeEmptyDOMElement();
    h.festivalId = 'f1';
    setHook('none', { hidden: true });
    const c = render(<OfflineStatusChip />);
    expect(c.container).toBeEmptyDOMElement();
  });

  it('starts the download from a Download for offline button', () => {
    render(<OfflineStatusChip />);
    fireEvent.click(screen.getByRole('button', { name: 'Download for offline' }));
    expect(h.download).toHaveBeenCalledTimes(1);
  });

  it('shows a retry button for a partial download', () => {
    setHook('partial');
    render(<OfflineStatusChip />);
    fireEvent.click(screen.getByRole('button', { name: 'Offline download incomplete · Retry' }));
    expect(h.download).toHaveBeenCalledTimes(1);
  });

  it('disables the button and sets aria-busy while syncing', () => {
    setHook('syncing');
    render(<OfflineStatusChip />);
    const btn = screen.getByRole('button', { name: 'Downloading for offline…' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('shows a non-interactive status when ready', () => {
    setHook('ready');
    render(<OfflineStatusChip />);
    expect(screen.getByRole('status')).toHaveTextContent(/Available offline · synced/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
