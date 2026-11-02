import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFestivalMode } from './useFestivalMode';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

let mockDays: Array<{ date?: string }> = [];
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: { days: typeof mockDays }) => unknown) =>
    selector({ days: mockDays }),
}));

let mockIsTodayFestivalDay = false;
vi.mock('@festie/shared/stores/festivalModeStore', () => ({
  isTodayFestivalDay: () => mockIsTodayFestivalDay,
}));

describe('useFestivalMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDays = [];
    mockIsTodayFestivalDay = false;
  });

  it('returns showDayBanner=false on a normal day', () => {
    const { result } = renderHook(() => useFestivalMode('/'));
    expect(result.current.showDayBanner).toBe(false);
  });

  it.each(['/', '/cards'])('shows the banner and does not navigate on a festival day at %s', (path) => {
    mockIsTodayFestivalDay = true;
    const { result } = renderHook(() => useFestivalMode(path));
    expect(result.current.showDayBanner).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('returns showDayBanner=false on /festival-mode', () => {
    mockIsTodayFestivalDay = true;
    const { result } = renderHook(() => useFestivalMode('/festival-mode'));
    expect(result.current.showDayBanner).toBe(false);
  });
});
