import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

import PhaseHomeActions from './PhaseHomeActions';

describe('PhaseHomeActions', () => {
  it('renders a link as a button that navigates', async () => {
    render(
      <PhaseHomeActions
        actions={[{ key: 'wrap', kind: 'link', label: 'See your Festival Wrap', a11y: 'Open your Festival Wrap' }]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open your Festival Wrap' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/wrap' });
  });

  it('renders a hint as text with no button', () => {
    render(
      <PhaseHomeActions
        actions={[
          { key: 'first-pick', kind: 'hint', label: 'Pick your first sets below', a11y: 'Pick your first sets below' },
        ]}
      />,
    );
    expect(screen.getByText('Pick your first sets below')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a dismiss button only when onDismiss is given', () => {
    const onDismiss = vi.fn();
    const actions = [{ key: 'crew', kind: 'link', label: 'Invite your crew', a11y: 'Open crew' }] as const;
    const { rerender } = render(<PhaseHomeActions actions={[...actions]} />);
    expect(screen.queryByRole('button', { name: 'Hide these shortcuts' })).toBeNull();
    rerender(<PhaseHomeActions actions={[...actions]} onDismiss={onDismiss} />);
    screen.getByRole('button', { name: 'Hide these shortcuts' }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
