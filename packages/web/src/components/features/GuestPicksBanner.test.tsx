import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GUEST_PROMPT_COPY } from '@festie/shared/constants';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

import GuestPicksBanner from './GuestPicksBanner';

describe('GuestPicksBanner', () => {
  it('renders the shared copy', () => {
    render(<GuestPicksBanner />);
    expect(screen.getByRole('region', { name: 'Save your picks' })).toBeInTheDocument();
    expect(screen.getByText(GUEST_PROMPT_COPY.guestPicks.title)).toBeInTheDocument();
    expect(screen.getByText(GUEST_PROMPT_COPY.guestPicks.body)).toBeInTheDocument();
  });

  it('sends the buttons to /register and /login', () => {
    render(<GuestPicksBanner />);
    fireEvent.click(screen.getByRole('button', { name: GUEST_PROMPT_COPY.guestPicks.cta }));
    expect(navigate).toHaveBeenCalledWith({ to: '/register' });
    fireEvent.click(screen.getByRole('button', { name: GUEST_PROMPT_COPY.guestPicks.signIn }));
    expect(navigate).toHaveBeenCalledWith({ to: '/login' });
  });
});
