import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

import NotFoundPage from './not-found';

describe('NotFoundPage', () => {
  it('explains the miss and goes home, with no schedule controls', async () => {
    render(<NotFoundPage />);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to the schedule' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
    expect(screen.queryByTestId('festival-select')).not.toBeInTheDocument();
  });
});
