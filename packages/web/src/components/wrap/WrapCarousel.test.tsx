import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WrapCard } from '@festie/shared/types';

vi.mock('motion/react', () => ({
  useReducedMotion: () => true,
  motion: { span: (p: Record<string, unknown>) => <span data-testid="confetti-piece" {...{ className: p.className as string }} /> },
}));

import WrapCarousel from './WrapCarousel';

const cards: WrapCard[] = [
  { kind: 'plan', kicker: 'YOUR PLAN', headline: '3 sets planned' },
  { kind: 'top', kicker: 'YOUR TOP SETS', headline: 'Artist One' },
  { kind: 'summary', kicker: 'YOUR FESTIVAL WRAP', headline: '4.0 hours of music' },
];

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
});

describe('WrapCarousel', () => {
  it('moves the current card with next and previous', () => {
    render(<WrapCarousel cards={cards} festivalName="Coachella" byline={null} sharing={false} onShare={vi.fn()} />);
    const dots = screen.getAllByRole('button', { name: /^Card \d of 3$/ });
    expect(dots.map((d) => d.getAttribute('aria-current'))).toEqual(['true', null, null]);
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(screen.getAllByRole('button', { name: /^Card \d of 3$/ })[1]!.getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Previous card' }));
    expect(screen.getAllByRole('button', { name: /^Card \d of 3$/ })[0]!.getAttribute('aria-current')).toBe('true');
  });

  it('shares the current card node', () => {
    const onShare = vi.fn();
    render(<WrapCarousel cards={cards} festivalName="Coachella" byline={null} sharing={false} onShare={onShare} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share this card' }));
    expect(onShare).toHaveBeenCalledTimes(1);
    const [node, index] = onShare.mock.calls[0]!;
    expect(index).toBe(1);
    expect((node as HTMLElement).textContent).toContain('Artist One');
  });
});
