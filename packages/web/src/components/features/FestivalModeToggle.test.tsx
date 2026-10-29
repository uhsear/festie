import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFestivalModeStore } from '@festie/shared';
import FestivalModeToggle from './FestivalModeToggle';

const mockNavigate = vi.fn();
let mockPathname = '/cards';
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: mockPathname }),
  useNavigate: () => mockNavigate,
}));

describe('FestivalModeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFestivalModeStore.setState({ isFestivalMode: false, lowPowerMode: false });
  });

  it('reads as pressed on /festival-mode even when the store is off, and exits on click', async () => {
    mockPathname = '/festival-mode';
    render(<FestivalModeToggle />);
    const btn = screen.getByTestId('festival-mode-toggle');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(btn);
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/cards' });
    expect(useFestivalModeStore.getState().isFestivalMode).toBe(false);
  });

  it('reads as unpressed elsewhere and enters festival mode on click', async () => {
    mockPathname = '/cards';
    render(<FestivalModeToggle />);
    const btn = screen.getByTestId('festival-mode-toggle');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(btn);
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/festival-mode' });
    expect(useFestivalModeStore.getState().isFestivalMode).toBe(true);
  });
});
