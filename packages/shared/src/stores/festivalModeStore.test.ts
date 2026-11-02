import { describe, it, expect, beforeEach } from 'vitest';
import { useFestivalModeStore, isTodayFestivalDay } from './festivalModeStore';

describe('festivalModeStore', () => {
  beforeEach(() => {
    useFestivalModeStore.setState({ lowPowerMode: false });
  });

  describe('low-power mode', () => {
    it('starts off', () => {
      expect(useFestivalModeStore.getState().lowPowerMode).toBe(false);
    });

    it('setLowPowerMode(true) turns it on', () => {
      useFestivalModeStore.getState().setLowPowerMode(true);
      expect(useFestivalModeStore.getState().lowPowerMode).toBe(true);
    });

    it('setLowPowerMode(false) turns it off', () => {
      useFestivalModeStore.getState().setLowPowerMode(true);
      useFestivalModeStore.getState().setLowPowerMode(false);
      expect(useFestivalModeStore.getState().lowPowerMode).toBe(false);
    });

    it('setLowPowerMode keeps the value stable when already at the target', () => {
      useFestivalModeStore.getState().setLowPowerMode(false);
      expect(useFestivalModeStore.getState().lowPowerMode).toBe(false);
      useFestivalModeStore.getState().setLowPowerMode(true);
      useFestivalModeStore.getState().setLowPowerMode(true);
      expect(useFestivalModeStore.getState().lowPowerMode).toBe(true);
    });

    it('toggleLowPowerMode flips the flag', () => {
      useFestivalModeStore.getState().toggleLowPowerMode();
      expect(useFestivalModeStore.getState().lowPowerMode).toBe(true);
      useFestivalModeStore.getState().toggleLowPowerMode();
      expect(useFestivalModeStore.getState().lowPowerMode).toBe(false);
    });
  });

  describe('persistence partialize', () => {
    it('persists lowPowerMode', () => {
      useFestivalModeStore.getState().setLowPowerMode(true);
      const stored = localStorage.getItem('festie-festival-mode-v2');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.state).toHaveProperty('lowPowerMode', true);
    });

    it('persists only lowPowerMode under the v2 key', () => {
      useFestivalModeStore.getState().setLowPowerMode(true);
      const parsed = JSON.parse(localStorage.getItem('festie-festival-mode-v2')!);
      expect(parsed.state).toEqual({ lowPowerMode: true });
      expect(parsed.state).not.toHaveProperty('isFestivalMode');
    });
  });
});

describe('isTodayFestivalDay', () => {
  it('returns false for empty array', () => {
    expect(isTodayFestivalDay([])).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isTodayFestivalDay(null as unknown as string[])).toBe(false);
    expect(isTodayFestivalDay(undefined as unknown as string[])).toBe(false);
  });

  it('returns true when today is in the list', () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(isTodayFestivalDay([today])).toBe(true);
  });

  it('returns false when today is not in the list', () => {
    expect(isTodayFestivalDay(['1999-01-01', '1999-01-02'])).toBe(false);
  });

  it('returns true when today is among multiple dates', () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(isTodayFestivalDay(['1999-01-01', today, '2099-12-31'])).toBe(true);
  });
});
