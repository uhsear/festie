import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQueryClient } from '../../test-utils';
import { api } from '@festie/shared/services/api';
import RatingButtons from './RatingButtons';

vi.mock('@festie/shared/services/api', () => ({
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
  return renderWithQueryClient(<RatingButtons setId="s1" festivalId="f1" {...props} />);
}

describe('RatingButtons', () => {
  it('names all five steps, lowest first, and prints a label only on the active one', async () => {
    renderButtons();
    const steps = screen.getAllByRole('button', { name: /\(\d of 5\)/ });
    expect(steps.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Nope (1 of 5)',
      'Meh (2 of 5)',
      'Okay (3 of 5)',
      'Good (4 of 5)',
      'Fire (5 of 5)',
    ]);
    await screen.findByRole('button', { name: 'Fire (5 of 5)', pressed: true });
    expect(screen.getAllByText('Fire')).toHaveLength(1);
    expect(screen.queryByText('Nope')).toBeNull();
  });

  it('fills every step up to the selected one in aqua, with the same fill for Fire and Nope', async () => {
    renderButtons();
    const fire = await screen.findByRole('button', { name: 'Fire (5 of 5)', pressed: true });
    expect(fire).toHaveAttribute('data-step-state', 'active');
    expect(fire).toHaveClass('bg-accent-aqua');
    const nope = screen.getByRole('button', { name: 'Nope (1 of 5)' });
    expect(nope).toHaveAttribute('data-step-state', 'filled');
    expect(nope.className).toContain('bg-accent-aqua/20');
    expect(fire.className).not.toMatch(/amber|coral|danger/);
    expect(nope.className).not.toMatch(/amber|coral|danger/);
  });

  it('leaves the caption out when showCaption is false', async () => {
    renderButtons({ showCaption: false });
    await screen.findByRole('button', { name: 'Fire (5 of 5)', pressed: true });
    expect(screen.queryByText(/You rated this|Tap to rate/)).toBeNull();
  });

  it('marks the saved rating and captions it', async () => {
    renderButtons();
    const fire = await screen.findByRole('button', { name: 'Fire (5 of 5)' });
    await vi.waitFor(() => expect(fire).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByText('You rated this: Fire (5 of 5)')).toBeInTheDocument();
  });

  it('saves a memory with the current rating and a trimmed note', async () => {
    renderButtons();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a memory' }));
    fireEvent.change(screen.getByPlaceholderText('What do you want to remember?'), {
      target: { value: '  the drop  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/ratings/s1', { rating: 5, note: 'the drop' }, { clientId: 'rate-s1' }));
  });

  it('posts no note when only the rating changes', async () => {
    const onRated = vi.fn();
    renderButtons({ onRated });
    fireEvent.click(await screen.findByRole('button', { name: 'Good (4 of 5)' }));
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/ratings/s1', { rating: 4 }, { clientId: 'rate-s1' }));
    await vi.waitFor(() => expect(onRated).toHaveBeenCalledWith(4));
  });

  it('removes the current rating with the deterministic clientId', async () => {
    renderButtons();
    const fire = await screen.findByRole('button', { name: 'Fire (5 of 5)' });
    await vi.waitFor(() => expect(fire).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(fire);
    await vi.waitFor(() => expect(api.delete).toHaveBeenCalledWith('/ratings/s1', { clientId: 'rate-s1' }));
  });

  it('uses aria-disabled, not disabled, while saving so keyboard focus stays on the button', async () => {
    renderButtons();
    const good = await screen.findByRole('button', { name: 'Good (4 of 5)' });
    good.focus();
    fireEvent.click(good);
    expect(good).toHaveAttribute('aria-disabled', 'true');
    expect(good).not.toBeDisabled();
    expect(good).toHaveFocus();
    await vi.waitFor(() => expect(good).not.toHaveAttribute('aria-disabled'));
  });

  it('hides the memory field when showMemory is false', async () => {
    renderButtons({ showMemory: false });
    await screen.findByRole('button', { name: 'Fire (5 of 5)' });
    expect(screen.queryByRole('button', { name: 'Add a memory' })).not.toBeInTheDocument();
  });
});
