import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReplayIntroRow from './ReplayIntroRow';

describe('ReplayIntroRow', () => {
  it('clears the onboarding flag and goes home', async () => {
    localStorage.setItem('festie_onboarding_completed', 'true');
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<ReplayIntroRow />);
    await userEvent.click(screen.getByRole('button', { name: 'Replay intro' }));
    expect(localStorage.getItem('festie_onboarding_completed')).toBeNull();
    expect(assign).toHaveBeenCalledWith('/');
    vi.unstubAllGlobals();
  });
});
