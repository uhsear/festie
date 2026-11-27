import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuthTabs from './AuthTabs';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, search: _search, ...rest }: Record<string, unknown>) => (
    <a href={to as string} {...rest}>
      {children as React.ReactNode}
    </a>
  ),
}));

describe('AuthTabs', () => {
  it.each(['login', 'register'] as const)('draws the rounded pill control on %s', (active) => {
    render(<AuthTabs active={active} />);
    const nav = screen.getByRole('navigation', { name: 'Authentication method' });
    expect(nav.className).toContain('rounded-full');
    for (const seg of screen.getAllByRole('link')) expect(seg.className).toContain('rounded-full');
  });

  it('marks only the active screen as current', () => {
    render(<AuthTabs active="register" />);
    const current = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]!.getAttribute('href')).toBe('/register');
  });
});
