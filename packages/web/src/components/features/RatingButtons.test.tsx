import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RatingButtons from './RatingButtons';

vi.mock('@festie/shared/services', () => ({
  api: {
    get: vi.fn(async () => ({ ratings: [{ setId: 's1', rating: 5 }] })),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }),
}));
vi.mock('../../hooks/useHaptics', () => ({
  useHaptics: () => ({ select: vi.fn() }),
}));

function renderButtons() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RatingButtons setId="s1" festivalId="f1" />
    </QueryClientProvider>,
  );
}

describe('RatingButtons', () => {
  it('shows the five rating words', () => {
    renderButtons();
    for (const word of ['Fire', 'Good', 'Okay', 'Meh', 'Skip']) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
  });

  it('marks the saved rating and captions it', async () => {
    renderButtons();
    const fire = await screen.findByRole('radio', { name: 'Fire (5 of 5)' });
    await vi.waitFor(() => expect(fire).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByText('You rated this: Fire (5 of 5)')).toBeInTheDocument();
  });
});
