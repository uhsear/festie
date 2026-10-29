import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import NotFoundPage from './not-found';

describe('NotFoundPage', () => {
  it('explains the miss and links home, with no schedule controls', () => {
    render(<NotFoundPage />);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the schedule' })).toHaveAttribute('href', '/');
    expect(screen.queryByTestId('festival-select')).not.toBeInTheDocument();
  });
});
