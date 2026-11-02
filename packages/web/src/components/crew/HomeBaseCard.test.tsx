import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { putMock } = vi.hoisted(() => ({ putMock: vi.fn() }));

vi.mock('@festie/shared', async () => {
  const { formatTime } = await vi.importActual<typeof import('@festie/shared/utils')>('@festie/shared/utils');
  return {
    api: { put: putMock },
    formatTime,
    writeOutcomeOf: () => 'sent',
    writeOutcomeMessage: (_o: string, m: string) => m,
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: ({ mutationFn }: { mutationFn: (p: unknown) => Promise<unknown> }) => ({
    mutate: (p: unknown) => void mutationFn(p),
    isPending: false,
  }),
}));

vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));

import HomeBaseCard from './HomeBaseCard';

function renderCard(currentTime: string) {
  return render(<HomeBaseCard crewId="c1" currentLocation="Camp" currentTime={currentTime} isOwner />);
}

describe('HomeBaseCard', () => {
  it('shows an HH:MM time as 12-hour', () => {
    renderCard('18:00');
    expect(screen.getByText('6:00 PM')).toBeInTheDocument();
  });

  it('shows a legacy free-text time as typed and keeps it when saved untouched', async () => {
    const user = userEvent.setup();
    renderCard('6:00 PM');
    expect(screen.getByText('6:00 PM')).toBeInTheDocument();

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(putMock).toHaveBeenCalledWith('/crews/c1/home-base', { location: 'Camp', time: '6:00 PM' });
  });

  it('clears a saved HH:MM time when the field is emptied', async () => {
    const user = userEvent.setup();
    putMock.mockClear();
    renderCard('18:00');

    await user.click(screen.getByRole('button'));
    await user.clear(screen.getByLabelText('Meet at time'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(putMock).toHaveBeenCalledWith('/crews/c1/home-base', { location: 'Camp', time: null });
  });

  it('renders a readable non-interactive card for members', () => {
    render(<HomeBaseCard crewId="c1" currentLocation="Ferris wheel" currentTime="18:00" isOwner={false} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Home base:')).toBeInTheDocument();
    expect(screen.getByText('Ferris wheel')).toBeInTheDocument();
  });

  it('renders an enabled button for owners', () => {
    render(<HomeBaseCard crewId="c1" currentLocation="Ferris wheel" currentTime={null} isOwner />);
    expect(screen.getByRole('button')).toBeEnabled();
  });
});
