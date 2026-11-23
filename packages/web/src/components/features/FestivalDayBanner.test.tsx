import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FestivalDayBanner from './FestivalDayBanner';
import { useAnnouncementStore } from '@festie/shared/stores/announcementStore';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { useAuthStore } from '@festie/shared/stores/authStore';
import type { FestivalAnnouncement, SosEntry } from '@festie/shared/types';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        (rest.onClick as (() => void) | undefined)?.();
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock('../../hooks/useHaptics', () => ({
  useHaptics: () => ({
    tap: vi.fn(),
    select: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    isSupported: true,
  }),
}));

describe('FestivalDayBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('renders the banner with festival day text', () => {
    render(<FestivalDayBanner />);
    expect(screen.getByTestId('festival-day-banner')).toBeInTheDocument();
    expect(screen.getByText(/festival day/i)).toBeInTheDocument();
  });

  it('has an Open Now & Next link to /festival-mode', () => {
    render(<FestivalDayBanner />);
    const link = screen.getByTestId('festival-day-banner-enter');
    expect(link).toHaveAttribute('href', '/festival-mode');
    expect(link).toHaveTextContent('Open Now & Next');
  });

  it('has a dismiss button', () => {
    render(<FestivalDayBanner />);
    expect(screen.getByTestId('festival-day-banner-close')).toBeInTheDocument();
  });

  it('dismisses the banner when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<FestivalDayBanner />);
    await user.click(screen.getByTestId('festival-day-banner-close'));
    expect(screen.queryByTestId('festival-day-banner')).not.toBeInTheDocument();
  });

  it('sets sessionStorage on dismiss', async () => {
    const user = userEvent.setup();
    render(<FestivalDayBanner />);
    await user.click(screen.getByTestId('festival-day-banner-close'));
    expect(sessionStorage.getItem('festie-fm-day-banner-dismissed')).toBe('true');
  });

  it('does not render if already dismissed in session', () => {
    sessionStorage.setItem('festie-fm-day-banner-dismissed', 'true');
    const { container } = render(<FestivalDayBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('hides the banner after the link is clicked', async () => {
    const user = userEvent.setup();
    render(<FestivalDayBanner />);
    await user.click(screen.getByTestId('festival-day-banner-enter'));
    expect(screen.queryByTestId('festival-day-banner')).not.toBeInTheDocument();
  });

  it('has role=status for accessibility', () => {
    render(<FestivalDayBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has accessible dismiss label', () => {
    render(<FestivalDayBanner />);
    expect(screen.getByLabelText('Dismiss festival day reminder')).toBeInTheDocument();
  });

  describe('while a higher-priority banner shows', () => {
    afterEach(() => {
      useAnnouncementStore.setState({ items: [], dismissed: [] });
      useLiveLocationStore.setState({ activeSosList: [] });
      useAuthStore.setState({ user: null });
    });

    it('hides for an urgent announcement and returns when it clears', () => {
      const urgent = { id: 'a1', festivalId: 'f1', severity: 'urgent', title: 't', body: 'b', screen: 'home', sentAt: '2026-11-01T10:00:00Z' } as FestivalAnnouncement;
      useAnnouncementStore.setState({ items: [urgent], dismissed: [] });
      const { rerender } = render(<FestivalDayBanner />);
      expect(screen.queryByTestId('festival-day-banner')).not.toBeInTheDocument();
      act(() => useAnnouncementStore.setState({ dismissed: ['a1'] }));
      rerender(<FestivalDayBanner />);
      expect(screen.getByTestId('festival-day-banner')).toBeInTheDocument();
    });

    it('stays for an info announcement', () => {
      const info = { id: 'a2', festivalId: 'f1', severity: 'info', title: 't', body: 'b', screen: 'home', sentAt: '2026-11-01T10:00:00Z' } as FestivalAnnouncement;
      useAnnouncementStore.setState({ items: [info], dismissed: [] });
      render(<FestivalDayBanner />);
      expect(screen.getByTestId('festival-day-banner')).toBeInTheDocument();
    });

    it('hides for an active SOS', () => {
      useAuthStore.setState({ user: { id: 'u1', username: 'me' } as never });
      useLiveLocationStore.setState({
        activeSosList: [{ crewId: 'c1', userId: 'u2', username: 'sam', raisedAt: new Date().toISOString() } as SosEntry],
      });
      render(<FestivalDayBanner />);
      expect(screen.queryByTestId('festival-day-banner')).not.toBeInTheDocument();
    });
  });
});
