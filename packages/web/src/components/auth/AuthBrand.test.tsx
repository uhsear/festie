import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import AuthBrand from './AuthBrand';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

describe('AuthBrand mark', () => {
  afterEach(() => useUIStore.setState({ theme: 'stage' }));

  it.each([
    ['stage', '/favicon.svg'],
    ['daylight', '/favicon-daylight.svg'],
  ] as const)('loads the %s mark file', (theme, file) => {
    useUIStore.setState({ theme });
    const { container } = render(<AuthBrand />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(file);
  });
});
