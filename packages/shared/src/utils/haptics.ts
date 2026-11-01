/**
 * One haptic vocabulary for web and mobile. Each platform's useHaptics() maps
 * these kinds to its own API (navigator.vibrate, expo-haptics, Vibration).
 *
 * | Kind      | Use for                                  |
 * |-----------|------------------------------------------|
 * | selection | chips, priority and day switches         |
 * | light     | pick or remove                           |
 * | success   | join, save, settle-up                    |
 * | warning   | clash created                            |
 * | error     | failed save                              |
 * | heavy     | SOS only                                 |
 *
 * No haptic on plain navigation.
 */
export type HapticKind = 'selection' | 'light' | 'success' | 'warning' | 'error' | 'heavy';

/** navigator.vibrate format: a number, or ON/OFF durations in ms that start with ON. */
export const VIBRATION_PATTERNS: Record<HapticKind, number | number[]> = {
  selection: 30,
  light: 15,
  success: [30, 50, 30],
  warning: [50, 30, 50, 30, 50],
  error: [80, 40, 80],
  heavy: [200, 100, 200, 100, 200],
};

/** Android Vibration.vibrate patterns start with a wait, so prepend a 0 ms wait. */
export function toAndroidPattern(p: number | number[]): number | number[] {
  return typeof p === 'number' ? p : [0, ...p];
}

/** Heavy is SOS only and always plays, for safety, even with haptics turned off. */
export function shouldBuzz(kind: HapticKind, enabled: boolean): boolean {
  return enabled || kind === 'heavy';
}
