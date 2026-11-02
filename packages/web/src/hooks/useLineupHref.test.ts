import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFestivalStore } from '@festie/shared';
import { useLineupHref } from './useLineupHref';

const timedSet = { id: 's1', startTime: '20:00', endTime: '21:00' };
const festival = { id: 'f1', startDate: '2026-07-10', endDate: '2026-07-12' };
const days = ['2026-07-10', '2026-07-11', '2026-07-12'].map((date, index) => ({ index, date, label: date }));

function setStore(state: Record<string, unknown>) {
  useFestivalStore.setState(state as never);
}

describe('useLineupHref', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    setStore({ scheduleView: null, sets: [], days: [], currentFestival: null });
  });

  it('uses the stored view', () => {
    setStore({ scheduleView: 'grid', sets: [], days: [], currentFestival: null });
    expect(renderHook(() => useLineupHref()).result.current).toBe('/grid');
  });

  it('defaults to timeline when live with timed sets', () => {
    vi.setSystemTime(new Date('2026-07-11T18:00:00Z'));
    setStore({ scheduleView: null, sets: [timedSet], days, currentFestival: festival });
    expect(renderHook(() => useLineupHref()).result.current).toBe('/timeline');
  });

  it('defaults to cards before the festival', () => {
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    setStore({ scheduleView: null, sets: [timedSet], days, currentFestival: festival });
    expect(renderHook(() => useLineupHref()).result.current).toBe('/cards');
  });
});
