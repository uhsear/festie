import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { usePullToRefresh } from './usePullToRefresh';

const success = vi.fn();
vi.mock('./useHaptics', () => ({ useHaptics: () => ({ success }) }));

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => usePullToRefresh({ threshold: 80 }), { wrapper });

  const outer = document.createElement('div');
  const inner = document.createElement('div');
  outer.appendChild(inner);

  const touch = (target: Element, x: number, y: number) =>
    ({ target, currentTarget: outer, touches: [{ clientX: x, clientY: y }] }) as unknown as React.TouchEvent;
  const start = (target: Element = inner, x = 100, y = 100) =>
    act(() => result.current.bind.onTouchStart(touch(target, x, y)));
  const move = (x: number, y: number) =>
    act(() => result.current.bind.onTouchMove(touch(inner, x, y)));
  const end = () => act(() => result.current.bind.onTouchEnd(touch(inner, 0, 0)));
  const cancel = () => act(() => result.current.bind.onTouchCancel(touch(inner, 0, 0)));

  return { result, invalidate, outer, inner, start, move, end, cancel };
}

function scrolled(el: Element, top: number) {
  Object.defineProperty(el, 'scrollTop', { value: top, configurable: true });
}

describe('usePullToRefresh', () => {
  beforeEach(() => success.mockClear());

  it('refreshes after a normal pull past the threshold', () => {
    const { result, invalidate, start, move, end } = setup();
    start();
    move(100, 140);
    expect(result.current.pullProgress).toBe(0.5);
    move(102, 190);
    end();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(result.current.isRefreshing).toBe(true);
    expect(success).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when released below the threshold', () => {
    const { result, invalidate, start, move, end } = setup();
    start();
    move(100, 130);
    end();
    expect(invalidate).not.toHaveBeenCalled();
    expect(result.current.pullProgress).toBe(0);
  });

  it('does not arm when an inner scroller on the touch path is scrolled', () => {
    const { result, invalidate, inner, start, move, end } = setup();
    scrolled(inner, 30);
    start();
    move(100, 200);
    end();
    expect(result.current.pullProgress).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not arm when the wrapper itself is scrolled', () => {
    const { result, invalidate, outer, start, move, end } = setup();
    scrolled(outer, 10);
    start();
    move(100, 200);
    end();
    expect(result.current.pullProgress).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('aborts the gesture when the first 8px of movement are horizontal', () => {
    const { result, invalidate, start, move, end } = setup();
    start();
    move(120, 105);
    move(120, 200);
    end();
    expect(result.current.pullProgress).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('ignores movement under 8px so a tap-jitter does not lock an axis', () => {
    const { result, invalidate, start, move, end } = setup();
    start();
    move(104, 102);
    expect(result.current.pullProgress).toBe(0);
    move(104, 190);
    end();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('resets on touchcancel without refreshing', () => {
    const { result, invalidate, start, move, end, cancel } = setup();
    start();
    move(100, 140);
    expect(result.current.pullProgress).toBe(0.5);
    cancel();
    expect(result.current.pullProgress).toBe(0);
    end();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
