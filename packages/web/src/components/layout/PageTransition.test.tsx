import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let pathname = '/a';
vi.mock('@tanstack/react-router', () => ({ useLocation: () => ({ pathname }) }));

import PageTransition from './PageTransition';

describe('PageTransition', () => {
  it('renders its children', () => {
    render(<PageTransition><p>Page</p></PageTransition>);
    expect(screen.getByText('Page')).toBeInTheDocument();
  });

  it('remounts the wrapper when the path changes', () => {
    const { rerender } = render(<PageTransition><p>Page</p></PageTransition>);
    const first = screen.getByText('Page').parentElement;
    pathname = '/b';
    rerender(<PageTransition><p>Page</p></PageTransition>);
    expect(screen.getByText('Page').parentElement).not.toBe(first);
  });
});
