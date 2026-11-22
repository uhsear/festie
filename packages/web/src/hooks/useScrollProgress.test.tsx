import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScrollProgress } from './useScrollProgress';

describe('useScrollProgress', () => {
  it('writes the scroll variables to the vars target, not the container', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const { result } = renderHook(() => useScrollProgress<HTMLDivElement>());
    const container = document.createElement('div');
    const beam = document.createElement('div');
    Object.defineProperties(container, {
      scrollTop: { value: 50 },
      scrollLeft: { value: 12 },
      scrollHeight: { value: 300 },
      clientHeight: { value: 100 },
    });
    result.current.ref.current = container;
    result.current.varsRef.current = beam;
    result.current.handleScroll();
    expect(beam.style.getPropertyValue('--scroll-progress')).toBe('0.25');
    expect(beam.style.getPropertyValue('--scroll-left')).toBe('12px');
    expect(container.style.getPropertyValue('--scroll-progress')).toBe('');
    expect(container.style.getPropertyValue('--scroll-left')).toBe('');
  });
});
