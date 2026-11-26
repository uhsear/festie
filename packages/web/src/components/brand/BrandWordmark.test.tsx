import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import BrandWordmark from './BrandWordmark';

describe('BrandWordmark', () => {
  afterEach(() => useUIStore.setState({ theme: 'stage' }));

  it('uses one weight and house-light text at every breakpoint', () => {
    const { getByTestId } = render(<BrandWordmark />);
    const cls = getByTestId('brand-wordmark').className;
    expect(cls).toContain('font-bold');
    expect(cls).toContain('text-text-primary');
    expect(cls).not.toMatch(/font-(normal|medium|semibold)/);
    expect(cls).not.toContain('text-accent-coral');
    expect(cls).toContain('max-[480px]:tracking-');
  });

  it('draws the theme mark only when markSize is set', () => {
    const none = render(<BrandWordmark />);
    expect(none.container.querySelector('img')).toBeNull();
    none.unmount();
    useUIStore.setState({ theme: 'daylight' });
    const { container } = render(<BrandWordmark markSize={24} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/favicon-daylight.svg');
    expect(img?.getAttribute('width')).toBe('24');
  });
});
