import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FestivalDay, FestivalSet } from '@festie/shared/types';

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: mockToast }) }));

import ListenList from './ListenList';

const days: FestivalDay[] = [{ id: 'd0', festivalId: 'f', date: '2026-11-07', label: 'Saturday', createdAt: '' }];
const mk = (id: string, artist: string, startTime: string, spotify?: string): FestivalSet => ({
  id,
  festivalId: 'f',
  stageId: 's',
  dayIndex: 0,
  startTime,
  endTime: '',
  artist,
  artists: spotify ? [{ name: artist, links: { spotify } }] : undefined,
  createdAt: '',
  updatedAt: '',
});
const sets = [mk('b', 'Bravo', '22:00'), mk('a', 'Alpha', '20:00', 'https://open.spotify.com/artist/abc123')];

describe('ListenList', () => {
  it('lists picks by day with a Spotify link only where one exists', () => {
    render(<ListenList sets={sets} days={days} festivalName="Fest" />);
    expect(screen.getByText('Saturday, Nov 7')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['AlphaSpotify ↗', 'Bravo']);
    expect(screen.getByRole('link', { name: 'Open Alpha in Spotify' })).toHaveAttribute(
      'href',
      'https://open.spotify.com/artist/abc123',
    );
  });

  it('copies the list as text', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ListenList sets={sets} days={days} festivalName="Fest" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await vi.waitFor(() => expect(mockToast).toHaveBeenCalledWith('List copied', 'success'));
    expect(writeText).toHaveBeenCalledWith(
      'Listen before you go: Fest\n\nSaturday, Nov 7\n- Alpha: https://open.spotify.com/artist/abc123\n- Bravo',
    );
  });

  it('renders nothing with no sets', () => {
    const { container } = render(<ListenList sets={[]} days={days} festivalName="Fest" />);
    expect(container).toBeEmptyDOMElement();
  });
});
