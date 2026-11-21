import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Last value the OS reported; null until the first async read resolves. Module-level
// so every screen mounted after the first read starts with the real answer, and the
// read starts at import time, before the first screen renders.
let known: boolean | null = null;

function readInitial(): void {
  AccessibilityInfo.isReduceMotionEnabled()
    .then((enabled) => {
      known = enabled;
    })
    .catch(() => {
      // Query failed: `known` stays null and consumers keep treating motion as off.
    });
}
readInitial();

/**
 * Tracks the OS "Reduce Motion" accessibility setting.
 *
 * React Native has no CSS `prefers-reduced-motion` media query, so every
 * animated surface must consult this hook and disable / short-circuit its
 * motion when it returns `true`. We read the initial value via
 * `AccessibilityInfo.isReduceMotionEnabled()` and stay in sync by subscribing
 * to the `reduceMotionChanged` event for the lifetime of the component.
 *
 * Returns `true` (motion off) until the async read resolves. Reanimated
 * `entering` animations only run at mount, so a `false` default attached them
 * before the answer arrived; with the Android animation scale at 0 they never
 * finished and left headings invisible. Content must be visible when the
 * setting is on or unknown, so unknown counts as on.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(known ?? true);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        known = enabled;
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {
        // Query failed: keep the safe default (motion off, content visible).
      });

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      known = enabled;
      setReduceMotion(enabled);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}
