/**
 * useHaptics (mobile): haptic feedback on the shared vocabulary from
 * @festie/shared/utils (haptics.ts). The same kinds drive web and mobile.
 *
 * | Kind      | Hook method | Use for                          |
 * |-----------|-------------|----------------------------------|
 * | selection | select      | chips, priority and day switches |
 * | light     | tap         | pick or remove                   |
 * | success   | success     | join, save, settle-up            |
 * | warning   | warning     | clash created                    |
 * | error     | error       | failed save                      |
 * | heavy     | heavy       | SOS only                         |
 *
 * No haptic on plain navigation. The Vibration setting (uiStore.hapticsEnabled)
 * silences every kind except heavy, which always plays.
 *
 * Platform split:
 *  - iOS uses expo-haptics (the Taptic Engine). iOS's core RN Vibration API
 *    ignores durations/patterns, so it cannot carry this vocabulary.
 *  - Android uses the core RN Vibration API with the shared millisecond patterns.
 *
 * Both surfaces are wrapped so a missing/odd vibrator (or unavailable Taptic
 * Engine) can never break a UI interaction.
 */
import { Vibration, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { VIBRATION_PATTERNS, toAndroidPattern, shouldBuzz, type HapticKind } from '@festie/shared/utils';
import { useUIStore } from '@festie/shared/stores';

export interface UseHapticsReturn {
  tap: () => void;
  select: () => void;
  success: () => void;
  warning: () => void;
  error: () => void;
  heavy: () => void;
  isSupported: boolean;
}

const isIOS = Platform.OS === 'ios';
const isSupported = Platform.OS === 'android' || isIOS;

function safe(fn: () => void) {
  try {
    fn();
  } catch {
    // Never let a missing/odd vibrator or Taptic Engine break a UI interaction.
  }
}

function playIOS(kind: HapticKind) {
  switch (kind) {
    case 'selection':
      return Haptics.selectionAsync();
    case 'light':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    case 'heavy':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    case 'success':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    case 'warning':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    case 'error':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
}

/** Play one haptic kind, honoring the Vibration setting (heavy always plays). */
export function haptic(kind: HapticKind): void {
  if (!isSupported) return;
  if (!shouldBuzz(kind, useUIStore.getState().hapticsEnabled)) return;
  safe(() => {
    if (isIOS) void playIOS(kind);
    else Vibration.vibrate(toAndroidPattern(VIBRATION_PATTERNS[kind]));
  });
}

const api: UseHapticsReturn = {
  tap: () => haptic('light'),
  select: () => haptic('selection'),
  success: () => haptic('success'),
  warning: () => haptic('warning'),
  error: () => haptic('error'),
  heavy: () => haptic('heavy'),
  isSupported,
};

export function useHaptics(): UseHapticsReturn {
  return api;
}
