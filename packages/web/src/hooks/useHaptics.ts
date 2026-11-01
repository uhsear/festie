/**
 * useHaptics: haptic feedback via the Vibration API.
 *
 * Shared vocabulary (patterns live in @festie/shared/utils haptics.ts):
 *   select  (selection) chips, priority and day switches
 *   tap     (light)     pick or remove
 *   success             join, save, settle-up
 *   warning             clash created
 *   error               failed save
 *   heavy               SOS only; plays even when Vibration is off
 * No haptic on plain navigation. The Account "Vibration" switch
 * (uiStore.hapticsEnabled) silences everything except heavy.
 */
import { VIBRATION_PATTERNS, shouldBuzz, type HapticKind } from '@festie/shared/utils';
import { useUIStore } from '@festie/shared/stores/uiStore';

export interface UseHapticsReturn {
  tap: () => void;
  select: () => void;
  success: () => void;
  warning: () => void;
  error: () => void;
  heavy: () => void;
  isSupported: boolean;
}

/**
 * Gracefully falls back to no-op on unsupported browsers (Safari/iOS)
 *
 * @example
 * const { tap, select, success, isSupported } = useHaptics();
 * tap(); // light vibration for button taps
 */
export function useHaptics(): UseHapticsReturn {
  const isSupported = 'vibrate' in navigator;

  const buzz = (kind: HapticKind) => {
    if (!isSupported || !shouldBuzz(kind, useUIStore.getState().hapticsEnabled)) return;
    try {
      navigator.vibrate(VIBRATION_PATTERNS[kind]);
    } catch {
      // Silently fail on unsupported browsers (Safari iOS ignores silently,
      // some Androids require prior user-gesture). Not observable to users.
    }
  };

  return {
    tap: () => buzz('light'),
    select: () => buzz('selection'),
    success: () => buzz('success'),
    warning: () => buzz('warning'),
    error: () => buzz('error'),
    heavy: () => buzz('heavy'),
    isSupported,
  };
}
