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
        actions={[{ key: 'wrap', kind: 'link', label: 'See your festival wrap', a11y: 'Open your festival wrap' }]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open your festival wrap' }));
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
});
