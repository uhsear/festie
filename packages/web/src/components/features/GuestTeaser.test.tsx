import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GUEST_PROMPT_COPY } from '@festie/shared/constants';
import GuestTeaser from './GuestTeaser';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ href: '/crew?x=1' }),
}));

describe('GuestTeaser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['picks', 'crew', 'wrap'] as const)('renders the shared %s title and message', (mode) => {
    render(<GuestTeaser mode={mode} />);
    const copy = GUEST_PROMPT_COPY.teasers[mode];
    expect(screen.getByText(copy.title)).toBeInTheDocument();
    expect(screen.getByText(copy.message)).toBeInTheDocument();
  });

  it('renders both buttons', () => {
    render(<GuestTeaser mode="picks" />);
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('has correct aria-labelledby linking heading to section', () => {
    render(<GuestTeaser mode="picks" />);
    const section = document.querySelector('section');
    expect(section).toHaveAttribute('aria-labelledby', 'guest-teaser-picks-heading');
    expect(screen.getByText('Save your festival picks')).toHaveAttribute('id', 'guest-teaser-picks-heading');
  });

  it('renders icon with aria-hidden', () => {
    const { container } = render(<GuestTeaser mode="picks" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<GuestTeaser mode="picks" className="mt-10" />);
    expect(container.querySelector('section')?.className).toContain('mt-10');
  });

  it('navigates to /login with the current href as next', async () => {
    const user = userEvent.setup();
    render(<GuestTeaser mode="crew" />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login', search: { next: '/crew?x=1' } });
  });

  it('navigates to /register with the current href as next', async () => {
    const user = userEvent.setup();
    render(<GuestTeaser mode="crew" />);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/register', search: { next: '/crew?x=1' } });
  });
});
