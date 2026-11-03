import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useAuthStore, useFestivalDataStore } from '@festie/shared/stores';
import { usePicks } from '@festie/shared/hooks';
import { COPY } from '@festie/shared/constants';
import { nextPickInCycle } from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';
import { useHaptics } from './useHaptics';
import { QUICK_PICK_ACTIONS, priorityForAction } from '../lib/quickPick';

const HOLD_DELAY_MS = 350;

/** Hold-to-pick for schedule blocks: setPick saves, holdToPick returns the gesture props. */
export function useQuickPick() {
  const router = useRouter();
  const haptics = useHaptics();
  const { savePick } = usePicks();
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const user = useAuthStore((s) => s.user);

  const setPick = useCallback(
    (setId: string, priority: Priority | null) => {
      if (!currentFestival) return;
      if (!currentProfile) {
        router.push(user ? `/set/${setId}` : '/(auth)/login');
        return;
      }
      // savePick rolls back and records the error in the store (rollbackKeys); same as every other caller.
      savePick(currentFestival.id, setId, priority).catch(() => {});
    },
    [currentFestival, currentProfile, user, router, savePick],
  );

  const holdToPick = useCallback(
    (setId: string, current: Priority | null | undefined) => ({
      onLongPress: () => {
        haptics.select();
        setPick(setId, nextPickInCycle(current));
      },
      delayLongPress: HOLD_DELAY_MS,
      accessibilityActions: QUICK_PICK_ACTIONS.map((a) => ({ ...a })),
      onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
        const next = priorityForAction(e.nativeEvent.actionName);
        if (next !== undefined) setPick(setId, next);
      },
      accessibilityHint: COPY.grid.holdHint,
    }),
    [haptics, setPick],
  );

  return { setPick, holdToPick };
}
