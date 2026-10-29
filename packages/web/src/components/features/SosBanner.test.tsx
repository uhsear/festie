import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SosEntry } from '@festie/shared/types';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }));
vi.mock('@festie/shared/stores', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: 'me' } }),
}));
let entries: SosEntry[] = [];
vi.mock('@festie/shared/hooks', () => ({ useActiveSos: () => entries, useLiveLocationCrewSync: () => {} }));

import SosBanner from './SosBanner';

describe('SosBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T21:04:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('renders nothing without an active SOS', () => {
    entries = [];
    const { container } = render(<SosBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names who and when, announces once, and opens the crew', () => {
    entries = [{ crewId: 'c1', userId: 'dani', username: 'Dani', raisedAt: '2026-06-12T21:00:00Z' }];
    render(<SosBanner />);
    expect(screen.getByRole('alert')).toHaveTextContent('Dani needs help');
    // The live region carries no clock, so the minute tick never re-announces.
    expect(screen.getByRole('alert')).not.toHaveTextContent('ago');
    const button = screen.getByRole('button', { name: /Dani needs help, SOS 4m ago/ });
    // Not dismissible: the only control opens the crew.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(button);
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/crew' });
  });

  it('summarises several raisers', () => {
    entries = [
      { crewId: 'c1', userId: 'dani', username: 'Dani', raisedAt: '2026-06-12T21:00:00Z' },
      { crewId: 'c1', userId: 'sam', username: 'Sam', raisedAt: '2026-06-12T20:00:00Z' },
    ];
    render(<SosBanner />);
    expect(screen.getByRole('alert')).toHaveTextContent('Dani and 1 other need help');
  });
});
