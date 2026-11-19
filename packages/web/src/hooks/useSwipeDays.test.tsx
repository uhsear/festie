import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { FestivalDay } from '@festie/shared/types/domain';

type DragHandler = (state: { swipe: [number, number] }) => void;
let handler: DragHandler;
const select = vi.fn();

vi.mock('@use-gesture/react', () => ({
  useDrag: (fn: DragHandler) => {
    handler = fn;
    return () => ({});
  },
}));
vi.mock('./useHaptics', () => ({ useHaptics: () => ({ select }) }));

import { useSwipeDays } from './useSwipeDays';

const days = [{}, {}, {}] as unknown as FestivalDay[];

function swipe(selectedDay: number, swipeX: number) {
  const onSelectDay = vi.fn();
  renderHook(() => useSwipeDays({ days, selectedDay, onSelectDay }));
  handler({ swipe: [swipeX, 0] });
  return onSelectDay;
}

describe('useSwipeDays', () => {
  beforeEach(() => select.mockClear());

  it('moves to the next day on a left swipe, with haptics', () => {
    expect(swipe(0, -1)).toHaveBeenCalledWith(1);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('moves to the previous day on a right swipe', () => {
    expect(swipe(2, 1)).toHaveBeenCalledWith(1);
  });

  it('ignores a drag that is not a swipe', () => {
    expect(swipe(1, 0)).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('does not go past the last day', () => {
    expect(swipe(2, -1)).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('does not go before the first day', () => {
    expect(swipe(0, 1)).not.toHaveBeenCalled();
  });
});
