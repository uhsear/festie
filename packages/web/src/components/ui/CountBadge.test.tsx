import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CountBadge from './CountBadge';

describe('CountBadge', () => {
  it('is a 16px capsule at the 10px badge size, so every count looks the same', () => {
    render(<CountBadge>3</CountBadge>);
    expect(screen.getByText('3')).toHaveClass('min-w-4', 'h-4', 'rounded-full', 'text-[length:var(--font-size-10)]');
  });

  it('lets the caller position it and pass a11y attributes', () => {
    render(
      <CountBadge className="absolute top-1 right-1" aria-hidden="true">
        9+
      </CountBadge>,
    );
    const badge = screen.getByText('9+');
    expect(badge).toHaveClass('absolute', 'right-1');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
  });
});
