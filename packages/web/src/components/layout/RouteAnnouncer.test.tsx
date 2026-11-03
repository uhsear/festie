import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockPathname = '/';
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: mockPathname }),
}));
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: unknown) => unknown) => selector({ currentFestival: { name: 'Test Fest' } }),
}));

import RouteAnnouncer, { routeTitle } from './RouteAnnouncer';

describe('routeTitle', () => {
  it('maps known and unknown paths', () => {
    expect(routeTitle('/')).toEqual({ page: 'Schedule', festival: true });
    expect(routeTitle('/set/abc')).toEqual({ page: 'Set', festival: true });
    expect(routeTitle('/account')).toEqual({ page: 'Account', festival: false });
    expect(routeTitle('/nope')).toEqual({ page: 'Page not found', festival: false });
  });
});

describe('RouteAnnouncer', () => {
  it('sets the title, stays silent on first render, then announces navigation', () => {
    mockPathname = '/';
    const { rerender } = render(<RouteAnnouncer />);
    expect(document.title).toBe('Schedule · Test Fest · Festie');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    mockPathname = '/picks';
    rerender(<RouteAnnouncer />);
    expect(screen.getByRole('status')).toHaveTextContent('My picks page');
    expect(document.title).toBe('My picks · Test Fest · Festie');

    mockPathname = '/account';
    rerender(<RouteAnnouncer />);
    expect(document.title).toBe('Account · Festie');
  });
});
