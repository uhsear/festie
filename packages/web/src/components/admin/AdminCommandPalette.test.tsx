import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminCommandPalette from './AdminCommandPalette';

const setAdminSearch = vi.fn();
vi.mock('./useAdminSearch', () => ({ useAdminSearch: () => [{}, setAdminSearch] }));
vi.mock('./adminQueries', () => ({
  useAdminFestivals: () => ({
    data: [{ id: 'f1', name: 'Forbidden Kingdom', location: 'Orlando' }],
    isError: false,
  }),
  useAdminCrews: () => ({
    data: [{ id: 'c1', name: 'Forbidden Crew', inviteCode: 'ABC123', festivalName: 'Forbidden Kingdom' }],
    isError: false,
  }),
}));

const PLACEHOLDER = 'Find a festival, user, crew or invite code';

function openPalette() {
  render(<AdminCommandPalette />);
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  return screen.getByPlaceholderText(PLACEHOLDER);
}

describe('AdminCommandPalette', () => {
  beforeEach(() => setAdminSearch.mockReset());

  it('opens on Ctrl+K and lists the invite-code crew first', () => {
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'abc123' } });
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Forbidden Crew');
  });

  it('Arrow Down then Enter opens the crew target', () => {
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'forbidden' } });
    // Festival draws first, so one Arrow Down lands on the crew.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setAdminSearch).toHaveBeenCalledWith({ tab: 'crews', q: 'Forbidden Crew' });
  });

  it('uses the invite code as the crew filter when it matched', () => {
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'ABC123' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setAdminSearch).toHaveBeenCalledWith({ tab: 'crews', q: 'ABC123' });
  });

  it('Escape closes', () => {
    const input = openPalette();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
  });
});
