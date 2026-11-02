import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FestivalAnnouncement } from '@festie/shared/types';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const dismiss = vi.fn();
const load = vi.fn();
let state: Record<string, unknown>;
vi.mock('@festie/shared/stores/announcementStore', () => ({
  useAnnouncementStore: (sel: (s: unknown) => unknown) => sel(state),
}));
vi.mock('@festie/shared/stores/festivalDataStore', () => ({
  useFestivalDataStore: (sel: (s: unknown) => unknown) => sel({ currentFestivalId: 'f1' }),
}));

import AnnouncementBanner from './AnnouncementBanner';

const fa = (over: Partial<FestivalAnnouncement> = {}): FestivalAnnouncement => ({
  id: 'a1',
  festivalId: 'f1',
  severity: 'info',
  title: 'Gates open early',
  body: 'Doors at 2 PM.',
  screen: 'map',
  sentAt: '2026-11-01T10:00:00Z',
  ...over,
});

describe('AnnouncementBanner', () => {
  beforeEach(() => {
    dismiss.mockClear();
    load.mockClear();
    state = { items: [fa()], dismissed: [], load, dismiss };
  });

  it('renders kicker, title and body, and loads for the festival', () => {
    render(<AnnouncementBanner />);
    expect(screen.getByText('From Festie')).toBeInTheDocument();
    expect(screen.getByText('Gates open early')).toBeInTheDocument();
    expect(screen.getByText('Doors at 2 PM.')).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith('f1');
  });

  it('shows the urgent kicker', () => {
    state.items = [fa({ severity: 'urgent' })];
    render(<AnnouncementBanner />);
    expect(screen.getByText('Urgent · From Festie')).toBeInTheDocument();
  });

  it('has no Open link for home', () => {
    state.items = [fa({ screen: 'home' })];
    render(<AnnouncementBanner />);
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('Open links to the map and dismisses', async () => {
    render(<AnnouncementBanner />);
    const open = screen.getByText('Open');
    expect(open).toHaveAttribute('href', '/map');
    await userEvent.click(open);
    expect(dismiss).toHaveBeenCalledWith('a1');
  });

  it('dismiss calls the store', async () => {
    render(<AnnouncementBanner />);
    await userEvent.click(screen.getByLabelText('Dismiss announcement'));
    expect(dismiss).toHaveBeenCalledWith('a1');
  });

  it('renders nothing when dismissed', () => {
    state.dismissed = ['a1'];
    const { container } = render(<AnnouncementBanner />);
    expect(container.firstChild).toBeNull();
  });
});
