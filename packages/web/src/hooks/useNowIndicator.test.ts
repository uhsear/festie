import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNowIndicator } from './useNowIndicator';
import type { TimeBounds } from './useTimelineFilters';

// Festival zone is UTC with two days, so every case is independent of the host TZ.
const storeState = {
  days: [{ date: '2026-06-15' }, { date: '2026-06-16' }],
  currentFestival: { timeZone: 'UTC' },
};
vi.mock('@festie/shared/stores/festivalStore', () => ({
  useFestivalStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
  useFestivalDataStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

/** A festival-zone (UTC) wall clock on 2026-06-15 plus `dayOffset` days. */
const at = (h: number, m = 0, dayOffset = 0) => new Date(Date.UTC(2026, 5, 15 + dayOffset, h, m, 0));

describe('useNowIndicator', () => {
  let _rafCallback: FrameRequestCallback | null;

  beforeEach(() => {
    vi.useFakeTimers();
    _rafCallback = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      _rafCallback = cb;
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeBounds(minMin: number, maxMin: number): TimeBounds {
    return {
      minMin,
      maxMin,
      totalSlots: Math.ceil((maxMin - minMin) / 15),
    };
  }

  it('returns null when timeBounds is null', () => {
    const { result } = renderHook(() => useNowIndicator(null, 0));
    expect(result.current.nowIndicator).toBeNull();
  });

  it('returns null when current time is outside time bounds', () => {
    // Set "now" to 8:00 AM (480 min), bounds 600..960 (10AM-4PM)
    vi.setSystemTime(at(8, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));
    expect(result.current.nowIndicator).toBeNull();
  });

  it('returns 0% when current time equals the start of bounds', () => {
    // "now" = 10:00 AM (600 min), bounds 600..960
    vi.setSystemTime(at(10, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));
    expect(result.current.nowIndicator).toBe(0);
  });

  it('returns 50% when current time is at the midpoint', () => {
    // bounds 600..960, midpoint = 780 = 1:00 PM
    vi.setSystemTime(at(13, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));
    expect(result.current.nowIndicator).toBe(50);
  });

  it('returns 100% when current time equals the end of bounds', () => {
    // "now" = 4:00 PM (960 min), bounds 600..960
    vi.setSystemTime(at(16, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));
    expect(result.current.nowIndicator).toBe(100);
  });

  it('updates nowIndicator every 30 seconds', () => {
    // Start at 12:00 (720 min), bounds 600..960 => (720-600)/(960-600)*100 = 33.33%
    vi.setSystemTime(at(12, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));

    const initial = result.current.nowIndicator;
    expect(initial).toBeCloseTo(33.33, 1);

    // Advance 30 seconds + shift system time by 1 minute to see a change
    vi.setSystemTime(at(12, 1));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    const updated = result.current.nowIndicator;
    // Fake timers also advance the clock 30 s: 721.5 min => (721.5-600)/(960-600)*100 = 33.75%
    expect(updated).toBeCloseTo(33.75, 1);
    expect(updated).not.toBe(initial);
  });

  it('provides a gridRef', () => {
    const { result } = renderHook(() => useNowIndicator(null, 0));
    expect(result.current.gridRef).toBeDefined();
    expect(result.current.gridRef.current).toBeNull();
  });

  it('provides a scrollToNow function', () => {
    const { result } = renderHook(() => useNowIndicator(null, 0));
    expect(typeof result.current.scrollToNow).toBe('function');
  });

  it('scrollToNow scrolls the now-line into view', () => {
    vi.setSystemTime(at(13, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));

    // Set up a mock grid element with a .timeline-now-label child
    const mockGrid = document.createElement('div');
    const nowLine = document.createElement('div');
    nowLine.className = 'timeline-now-label';
    nowLine.scrollIntoView = vi.fn();
    mockGrid.appendChild(nowLine);

    // Assign to the gridRef
    Object.defineProperty(result.current.gridRef, 'current', {
      writable: true,
      value: mockGrid,
    });

    act(() => {
      result.current.scrollToNow();
    });

    expect(nowLine.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
  });

  it('scrollToNow is safe to call when gridRef is null', () => {
    vi.setSystemTime(at(13, 0));
    const bounds = makeBounds(600, 960);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));

    expect(() => {
      act(() => {
        result.current.scrollToNow();
      });
    }).not.toThrow();
  });

  it('cleans up the interval on unmount', () => {
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const { unmount } = renderHook(() => useNowIndicator(null, 0));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('calculates percentage correctly for narrow bounds', () => {
    // bounds 720..780 (12PM-1PM), now = 12:30 => 50%
    vi.setSystemTime(at(12, 30));
    const bounds = makeBounds(720, 780);
    const { result } = renderHook(() => useNowIndicator(bounds, 0));
    expect(result.current.nowIndicator).toBe(50);
  });

  it('returns null on a day tab whose date is not the festival day containing now', () => {
    // 12:00 on 06-15 against day 1 (06-16) with bounds 600..960
    vi.setSystemTime(at(12, 0));
    const { result } = renderHook(() => useNowIndicator(makeBounds(600, 960), 1));
    expect(result.current.nowIndicator).toBeNull();
  });

  it('shows the line on the previous night tab at 01:00 the next calendar day', () => {
    // Day 0 bounds 1200..1560 (20:00 to 02:00 next day); now = 01:00 on 06-16 = minute 1500 of day 0.
    vi.setSystemTime(at(1, 0, 1));
    const bounds = makeBounds(1200, 1560);
    const onFriday = renderHook(() => useNowIndicator(bounds, 0));
    expect(onFriday.result.current.nowIndicator).toBeCloseTo(((1500 - 1200) / 360) * 100, 5);
    const onSaturday = renderHook(() => useNowIndicator(bounds, 1));
    expect(onSaturday.result.current.nowIndicator).toBeNull();
  });
});
