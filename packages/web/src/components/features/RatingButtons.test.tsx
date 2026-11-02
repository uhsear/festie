import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@festie/shared/services';
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

function renderButtons(props: Partial<ComponentProps<typeof RatingButtons>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RatingButtons setId="s1" festivalId="f1" {...props} />
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

  it('saves a memory with the current rating and a trimmed note', async () => {
    renderButtons();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a memory' }));
    fireEvent.change(screen.getByPlaceholderText('What do you want to remember?'), {
      target: { value: '  the drop  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/ratings/s1', { rating: 5, note: 'the drop' }));
  });

  it('posts no note when only the rating changes', async () => {
    const onRated = vi.fn();
    renderButtons({ onRated });
    fireEvent.click(await screen.findByRole('radio', { name: 'Good (4 of 5)' }));
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/ratings/s1', { rating: 4 }));
    await vi.waitFor(() => expect(onRated).toHaveBeenCalledWith(4));
  });

  it('hides the memory field when showMemory is false', async () => {
    renderButtons({ showMemory: false });
    await screen.findByRole('radio', { name: 'Fire (5 of 5)' });
    expect(screen.queryByRole('button', { name: 'Add a memory' })).not.toBeInTheDocument();
  });
});
