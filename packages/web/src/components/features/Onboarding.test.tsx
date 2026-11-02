import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Onboarding from './Onboarding';

const DONE_KEY = 'festie_onboarding_completed';

describe('Onboarding sequencing', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('shows on a first visit with the brand mark on step one', () => {
    render(<Onboarding />);
    expect(screen.getByRole('dialog', { name: 'Welcome to Festie' })).toBeInTheDocument();
    expect(document.querySelector('img[src="/favicon.svg"]')).toBeInTheDocument();
  });

  it('is skipped, and not re-shown, when the visit arrived through an invite', () => {
    sessionStorage.setItem('fk.pendingJoinCrew', 'ABC123');
    const { rerender } = render(<Onboarding />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    sessionStorage.clear();
    rerender(<Onboarding />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(DONE_KEY)).toBe('true');
  });

  it('is skipped when a ?joinCrew= link is in the URL', () => {
    window.history.replaceState({}, '', '/cards?joinCrew=ABC123');
    render(<Onboarding />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('holds while the join prompt is open, then appears once it closes', () => {
    const { rerender } = render(<Onboarding suspended />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<Onboarding suspended={false} />);
    expect(screen.getByRole('dialog', { name: 'Welcome to Festie' })).toBeInTheDocument();
  });

  it('dismisses with Skip and stays dismissed on the next mount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Onboarding />);
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();
    render(<Onboarding />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on the last step and stays on the current page', async () => {
    window.history.replaceState({}, '', '/timeline');
    const user = userEvent.setup();
    render(<Onboarding />);
    for (let i = 0; i < 10 && !screen.queryByRole('button', { name: 'Get Started' }); i++) {
      await user.click(screen.getByRole('button', { name: 'Next' }));
    }
    await user.click(screen.getByRole('button', { name: 'Get Started' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/timeline');
  });
});
