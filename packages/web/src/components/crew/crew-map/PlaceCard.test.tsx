import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { placeShareText, type MapPlace } from '@festie/shared/utils';
import PlaceCard from './PlaceCard';

const stage: MapPlace = {
  id: 's1',
  kind: 'stage',
  name: 'Mainstage',
  kindLabel: 'Stage',
  coord: { latitude: 28.5, longitude: -81.4 },
};
const self = { latitude: 28.5, longitude: -81.401 };

function renderCard(over: Partial<React.ComponentProps<typeof PlaceCard>> = {}) {
  const props = {
    place: stage,
    selfCoord: self,
    geoState: 'on' as const,
    onShowWay: vi.fn(),
    onSetMeetingPoint: vi.fn(),
    onLocate: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<PlaceCard {...props} />);
  return props;
}

beforeEach(() => {
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
});
afterEach(() => vi.useRealTimers());

describe('PlaceCard', () => {
  it('shows the name, kind and walk line, and focuses Show the way', () => {
    renderCard();
    expect(screen.getByRole('dialog', { name: 'Mainstage' })).toBeInTheDocument();
    expect(screen.getByText('Stage')).toBeInTheDocument();
    expect(screen.getByText(/min walk · \d+ m/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show the way' })).toHaveFocus();
  });

  it('asks for location when there is no fix', () => {
    const props = renderCard({ selfCoord: null, geoState: 'idle' });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on location to see how far it is' }));
    expect(props.onLocate).toHaveBeenCalledTimes(1);
  });

  it('hides Set as meeting point for a meeting point and when the callback is missing', () => {
    renderCard({ place: { ...stage, kind: 'meeting-point', kindLabel: 'Meeting point' } });
    expect(screen.queryByRole('button', { name: 'Set as meeting point' })).toBeNull();
  });

  it('hides Set as meeting point without a callback', () => {
    renderCard({ onSetMeetingPoint: undefined });
    expect(screen.queryByRole('button', { name: 'Set as meeting point' })).toBeNull();
  });

  it('passes the place to Set as meeting point', () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Set as meeting point' }));
    expect(props.onSetMeetingPoint).toHaveBeenCalledWith(stage);
  });

  it('falls back to the clipboard and shows Copied for 2 seconds', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderCard();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    });
    expect(writeText).toHaveBeenCalledWith(placeShareText(stage));
    expect(screen.getByText('Copied')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('uses navigator.share when present', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    renderCard();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    });
    expect(share).toHaveBeenCalledWith({ text: placeShareText(stage) });
  });

  it('calls onClose on Escape', () => {
    const props = renderCard();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
