import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

import PhaseHomeActions from './PhaseHomeActions';

describe('PhaseHomeActions', () => {
  it.each(['pre', 'live', 'post'] as const)('renders five actions for %s', (phase) => {
    render(<PhaseHomeActions phase={phase} />);
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('leads with Festival wrap after the festival', async () => {
    render(<PhaseHomeActions phase="post" />);
    const first = screen.getAllByRole('button')[0]!;
    expect(first).toHaveTextContent('Festival wrap');
    first.click();
    expect(navigate).toHaveBeenCalledWith({ to: '/wrap' });
  });

  it('leads with Map while live', () => {
    navigate.mockClear();
    render(<PhaseHomeActions phase="live" />);
    const first = screen.getAllByRole('button')[0]!;
    expect(first).toHaveTextContent('Map');
    first.click();
    expect(navigate).toHaveBeenCalledWith({ to: '/map' });
  });
});
